import { describe, expect, test } from "bun:test";
import { onboardingActionArgs, pixelMaskPreferencesReady } from "./adb.js";

describe("Android onboarding actions", () => {
  test("opens Google Photos through its launcher intent without Monkey", () => {
    expect(onboardingActionArgs("open_photos", "com.google.android.apps.photos")).toEqual([
      "shell", "am", "start",
      "-a", "android.intent.action.MAIN",
      "-c", "android.intent.category.LAUNCHER",
      "-p", "com.google.android.apps.photos",
    ]);
  });
});

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
