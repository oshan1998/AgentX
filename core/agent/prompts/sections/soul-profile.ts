import type { Soul, User } from "../../../../managers/profile-manager.js";

export function soulProfile(soul: Soul, user: User): string {
  return `Soul:\n${JSON.stringify(soul, null, 2)}\n\nUser profile:\n${JSON.stringify(user, null, 2)}`;
}
