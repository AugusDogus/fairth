import { describe, expect, test } from "bun:test";
import {
  capturedAtTouchScript,
  destinationDigestMatches,
  destinationDigestScript,
  googleAccountPresent,
  onboardingActionArgs,
  pixelMaskPreferencesReady,
} from "./adb.js";

describe("Android media import", () => {
  test("restores the capture time before MediaStore scans the original filename", () => {
    expect(capturedAtTouchScript("/storage/emulated/0/DCIM/Camera/IMG_20200102_030405.jpg", 1_577_934_245_678)).toBe(
      "touch -m -d '@1577934245' '/storage/emulated/0/DCIM/Camera/IMG_20200102_030405.jpg'",
    );
  });

  test("checks existing destination bytes before treating a retry as complete", () => {
    expect(destinationDigestScript("/storage/emulated/0/DCIM/Camera/Today's photo.jpg")).toBe(
      "if test -f '/storage/emulated/0/DCIM/Camera/Today'\\''s photo.jpg'; then sha256sum '/storage/emulated/0/DCIM/Camera/Today'\\''s photo.jpg'; else printf missing; fi",
    );
    expect(destinationDigestMatches("abc123  /storage/emulated/0/DCIM/Camera/photo.jpg", "abc123")).toBe(true);
    expect(destinationDigestMatches("def456  /storage/emulated/0/DCIM/Camera/photo.jpg", "abc123")).toBe(false);
  });
});

describe("Android onboarding actions", () => {
  test("opens the system Google account flow", () => {
    expect(onboardingActionArgs("open_google_account")).toEqual([
      "shell", "am", "start", "-a", "android.settings.ADD_ACCOUNT_SETTINGS",
    ]);
  });
});

describe("Google account detection", () => {
  test("does not mistake the installed authenticator for a signed-in account", () => {
    const accounts = "    ServiceInfo: AuthenticatorDescription {type=com.google}, ComponentInfo{com.google.android.gms/.auth.AccountAuthenticatorService}";

    expect(googleAccountPresent(accounts)).toBe(false);
  });

  test("recognizes an actual Google account record", () => {
    const accounts = "  Account {name=owner@example.com, type=com.google}";

    expect(googleAccountPresent(accounts)).toBe(true);
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
