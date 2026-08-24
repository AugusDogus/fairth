import { spawn } from "node:child_process";
import type { AndroidController, AndroidOperationResult } from "@fairth/android-rpc";
import type { ReturnTypeAdb } from "./types.js";
import type { ImportDatabase } from "./database.js";

function operationResult(result: Awaited<ReturnType<ReturnTypeAdb["onboardingAction"]>>): AndroidOperationResult {
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

async function runProvisioningScript(): Promise<AndroidOperationResult> {
  const script = process.env.PROVISIONING_SCRIPT ?? "/usr/local/bin/fairth-provision-android";
  return new Promise((resolve) => {
    const child = spawn(script, [], { env: process.env, stdio: "inherit" });
    child.once("error", (error) => resolve({ ok: false, message: `Could not start Android provisioning: ${error.message}` }));
    child.once("close", (code, signal) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, message: `Android provisioning exited with ${code ?? signal ?? "unknown status"}. Review the android-worker logs for the failed step.` });
    });
  });
}

export function createAndroidController(adb: ReturnTypeAdb, database: ImportDatabase): AndroidController {
  let reconciliation: Promise<AndroidOperationResult> | undefined;
  let photosConfiguration: Promise<AndroidOperationResult> | undefined;

  async function reconcileProvisioning(): Promise<AndroidOperationResult> {
    reconciliation ??= runProvisioningScript().finally(() => {
      reconciliation = undefined;
    });
    return reconciliation;
  }

  return {
    onboarding: adb.onboarding,
    openGoogleAccount: async () => operationResult(await adb.onboardingAction("open_google_account")),
    configurePhotos: async () => {
      photosConfiguration ??= adb.configurePhotos().then(operationResult).finally(() => {
        photosConfiguration = undefined;
      });
      return photosConfiguration;
    },
    progress: async () => ({ imports: database.counts(), googlePhotos: await adb.googlePhotosProgress() }),
    reconcileProvisioning,
  };
}
