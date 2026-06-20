/**
 * Bundles a standalone, independently-deployable MCP server.
 *
 * It inlines AgentX's own source (common/services, llm-adapters, capability
 * tools, harness) into a single ESM file while keeping npm packages external,
 * then emits a trimmed package.json listing only the dependencies the server
 * actually reaches. The output folder can be copied to another host and run
 * with `npm install --omit=dev && node index.mjs`.
 *
 * Usage: node mcp/_harness/build-standalone.mjs <entry> <outName>
 *   e.g. node mcp/_harness/build-standalone.mjs mcp/design/index.ts design-mcp
 */
import { build } from "esbuild";
import { builtinModules } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const entry = process.argv[2];
const outName = process.argv[3];
if (!entry || !outName) {
  console.error("Usage: node mcp/_harness/build-standalone.mjs <entry> <outName>");
  process.exit(1);
}

const outDir = path.join(root, "dist-standalone", outName);
const outFile = path.join(outDir, "index.mjs");
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/** Maps a bare import specifier to its npm package name. */
function packageNameOf(specifier) {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return `${scope}/${name}`;
  }
  return specifier.split("/")[0];
}

async function resolveInstalledVersion(pkg) {
  try {
    const raw = await readFile(path.join(root, "node_modules", pkg, "package.json"), "utf-8");
    return JSON.parse(raw).version;
  } catch {
    return undefined;
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const result = await build({
    entryPoints: [path.join(root, entry)],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    packages: "external",
    metafile: true,
    logLevel: "info",
    // ESM interop banner for libraries that expect CJS globals.
    banner: {
      js: [
        "import { createRequire as __cr } from 'node:module';",
        "const require = __cr(import.meta.url);",
      ].join("\n"),
    },
  });

  const externals = new Set();
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imp of output.imports ?? []) {
      if (imp.external && imp.path) {
        const pkg = packageNameOf(imp.path);
        if (!builtins.has(pkg) && !pkg.startsWith("node:")) {
          externals.add(pkg);
        }
      }
    }
  }

  const dependencies = {};
  const missing = [];
  for (const pkg of [...externals].sort()) {
    const version = await resolveInstalledVersion(pkg);
    if (version) dependencies[pkg] = `^${version}`;
    else missing.push(pkg);
  }

  const pkgJson = {
    name: `agentx-${outName}`,
    version: "0.1.0",
    private: true,
    type: "module",
    description: `Standalone AgentX MCP server (${outName}).`,
    main: "index.mjs",
    scripts: { start: "node index.mjs" },
    dependencies,
  };
  await writeFile(path.join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n");

  const readme = `# agentx-${outName}

Standalone, independently-deployable AgentX MCP server. All AgentX source is
bundled into \`index.mjs\`; only the npm dependencies below are installed.

## Run

\`\`\`bash
npm install --omit=dev
# provide credentials/config via environment (e.g. .env or real env vars)
node index.mjs            # speaks MCP over stdio
\`\`\`

## Connect from AgentX

Point an entry in \`config/mcp-servers.json\` at this server:

\`\`\`json
{
  "mcpServers": {
    "${outName.replace(/-mcp$/, "")}": {
      "transport": "stdio",
      "command": "node",
      "args": ["/abs/path/to/${outName}/index.mjs"],
      "namePrefix": ""
    }
  }
}
\`\`\`

Set \`AGENTX_WORKSPACE_BASE\` so this server resolves the same workspace as the
host when deployed separately.
`;
  await writeFile(path.join(outDir, "README.md"), readme);

  console.log(`\nStandalone build → ${path.relative(root, outFile)}`);
  console.log(`Dependencies (${Object.keys(dependencies).length}):`);
  for (const [name, ver] of Object.entries(dependencies)) console.log(`  ${name} ${ver}`);
  if (missing.length) {
    console.warn(`\nWARNING: could not resolve versions for: ${missing.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
