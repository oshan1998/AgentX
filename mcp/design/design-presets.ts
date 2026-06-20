/** Named export sizes for social / marketing platforms (pixels). */
export const DESIGN_SIZE_PRESETS = {
  instagram_post: { width: 1080, height: 1080, label: "Instagram post (1:1)" },
  instagram_story: { width: 1080, height: 1920, label: "Instagram story (9:16)" },
  twitter_post: { width: 1200, height: 675, label: "X/Twitter post (16:9)" },
  linkedin_post: { width: 1200, height: 627, label: "LinkedIn post" },
  facebook_cover: { width: 820, height: 312, label: "Facebook cover" },
  youtube_thumbnail: { width: 1280, height: 720, label: "YouTube thumbnail (16:9)" },
  open_graph: { width: 1200, height: 630, label: "Open Graph / link preview" },
} as const;

export type DesignSizePresetName = keyof typeof DESIGN_SIZE_PRESETS;

export const DESIGN_PRESET_NAMES = Object.keys(DESIGN_SIZE_PRESETS) as DesignSizePresetName[];

export function resolvePresetName(name: string): DesignSizePresetName | undefined {
  const key = name.trim() as DesignSizePresetName;
  return key in DESIGN_SIZE_PRESETS ? key : undefined;
}
