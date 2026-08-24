import { createAuthService } from "./auth";
import { loadConfig } from "./config";
import { createCompanionPresence } from "./presence";
import { createUploadStorage } from "./storage";

async function initializeRuntime() {
  const config = loadConfig();
  const storage = createUploadStorage(config);
  await storage.initialize();
  const authService = await createAuthService(config);
  const companionPresence = createCompanionPresence(config.authDataRoot);

  return {
    authService,
    config,
    companionPresence,
    storage,
  };
}

let runtimePromise: ReturnType<typeof initializeRuntime> | undefined;

export function getRuntime(): ReturnType<typeof initializeRuntime> {
  runtimePromise ??= initializeRuntime();
  return runtimePromise;
}
