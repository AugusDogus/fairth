import { describe, expect, test } from "bun:test";
import { parseSessionRequest, safeFilename } from "./domain.js";

describe("safeFilename", () => {
  test("removes traversal and shell characters", () => {
    expect(safeFilename("../../my photo;$(oops).jpg")).toBe("my_photo_oops_.jpg");
  });
});

describe("parseSessionRequest", () => {
  test("accepts a bounded upload", () => {
    const result = parseSessionRequest({ filename: "IMG 1.jpg", size: 42, metadata: { deviceId: "pixel" } }, 100);
    expect(result).toEqual({ ok: true, value: { filename: "IMG_1.jpg", size: 42, metadata: { deviceId: "pixel" } } });
  });

  test("rejects oversized uploads", () => {
    const result = parseSessionRequest({ filename: "video.mp4", size: 101 }, 100);
    expect(result.ok).toBeFalse();
  });
});
