// Imported FIRST by every stdio MCP server entry, before any module that pulls
// in the shared logger. Routes console logging to stderr so it never corrupts
// the stdout JSON-RPC channel used by the MCP stdio transport.
process.env.AGENTX_LOG_STDERR = "1";
