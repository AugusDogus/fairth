import { describe, expect, test } from "bun:test";
import { pixelMaskPreferencesReady } from "./adb.js";

describe("PixelMask preferences", () => {
  test("accepts upstream defaults and the explicit original Pixel profile", () => {
    expect(pixelMaskPreferencesReady("")).toBe(true);
    expect(pixelMaskPreferencesReady('<map><string name="PREF_DEVICE_TO_SPOOF">Pixel</string></map>')).toBe(true);
  });

  test("rejects a disabled module or another spoof target", () => {
    expect(pixelMaskPreferencesReady('<map><boolean name="PREF_MODULE_ENABLED" value="false" /></map>')).toBe(false);
    expect(pixelMaskPreferencesReady('<map><string name="PREF_DEVICE_TO_SPOOF">Pixel XL</string></map>')).toBe(false);
  });
});
