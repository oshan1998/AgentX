import type { PromptSection } from "./sections/types.js";

export function composeSections<TContext>(
  sections: readonly PromptSection<TContext>[],
  ctx: TContext,
): string {
  return sections
    .filter((section) => !section.when || section.when(ctx))
    .map((section) => section.build(ctx))
    .filter((section) => section.trim().length > 0)
    .join("\n\n")
    .trim();
}
