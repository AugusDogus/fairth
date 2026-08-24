import { describe, expect, test } from "bun:test";
import { AndroidOnboardingSchema, androidRpcRouter, type AndroidController, type AndroidOnboarding } from "./index.js";

describe("AndroidOnboardingSchema", () => {
  test("accepts a typed action-required step", () => {
    expect(AndroidOnboardingSchema.safeParse({
      automaticReady: true,
      googleAccountReady: false,
      steps: [{
        id: "google_account",
        label: "Google account",
        detail: "Sign in to continue.",
        state: "action_required",
        action: "open_google_account",
      }],
    }).success).toBe(true);
  });

  test("rejects an unsupported worker action", () => {
    expect(AndroidOnboardingSchema.safeParse({
      automaticReady: true,
      googleAccountReady: false,
      steps: [{
        id: "google_account",
        label: "Google account",
        detail: "Sign in to continue.",
        state: "action_required",
        action: "run_shell",
      }],
    }).success).toBe(false);
  });
});

describe("androidRpcRouter", () => {
  test("forwards typed procedures to the Android controller", async () => {
    const onboarding: AndroidOnboarding = {
      automaticReady: true,
      googleAccountReady: true,
      steps: [{ id: "android", label: "Android", detail: "Ready.", state: "complete" }],
    };
    const android: AndroidController = {
      onboarding: async () => onboarding,
      openGoogleAccount: async () => ({ ok: true }),
      configurePhotos: async () => ({ ok: true }),
      reconcileProvisioning: async () => ({ ok: false, message: "Missing artifact." }),
      progress: async () => ({
        imports: { pending: 1, imported: 2, failed: 0, duplicate: 0 },
        googlePhotos: { state: "idle", detail: "Backup is enabled." },
      }),
    };
    const caller = androidRpcRouter.createCaller({ android });

    expect(await caller.status()).toEqual(onboarding);
    expect(await caller.configurePhotos()).toEqual({ ok: true });
    expect(await caller.progress()).toMatchObject({ imports: { pending: 1, imported: 2 } });
    expect(await caller.reconcileProvisioning()).toEqual({ ok: false, message: "Missing artifact." });
  });
});
