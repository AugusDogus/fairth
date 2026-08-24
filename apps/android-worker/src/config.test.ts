import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config.js";

describe("Android worker configuration", () => {
  test("imports media into the emulated camera roll by default", () => {
    const previous = process.env.ANDROID_MEDIA_DIRECTORY;
    delete process.env.ANDROID_MEDIA_DIRECTORY;

    try {
      expect(loadConfig().androidMediaDirectory).toBe("/storage/emulated/0/DCIM/Camera");
    } finally {
      if (previous === undefined) delete process.env.ANDROID_MEDIA_DIRECTORY;
      else process.env.ANDROID_MEDIA_DIRECTORY = previous;
    }
  });
});
