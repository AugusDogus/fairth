import type { ShareIntentFile } from "expo-share-intent";

export function sharedImages(files: readonly ShareIntentFile[] | null): ShareIntentFile[] {
  if (files === null) return [];
  return files.filter((file) => file.path.length > 0 && file.mimeType.startsWith("image/"));
}
