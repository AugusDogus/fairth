import { describe, expect, test } from "bun:test";
import type { ShareIntentFile } from "expo-share-intent";
import { sharedImages } from "./shared-media";

function sharedFile(path: string, mimeType: string): ShareIntentFile {
  return {
    path,
    mimeType,
    fileName: "shared-file",
    size: 1,
    width: null,
    height: null,
    duration: null,
  };
}

describe("sharedImages", () => {
  test("keeps only readable image shares", () => {
    const photo = sharedFile("file:///photo.png", "image/png");

    expect(sharedImages([
      photo,
      sharedFile("file:///clip.mp4", "video/mp4"),
      sharedFile("", "image/jpeg"),
    ])).toEqual([photo]);
  });

  test("handles a share without files", () => {
    expect(sharedImages(null)).toEqual([]);
  });
});
