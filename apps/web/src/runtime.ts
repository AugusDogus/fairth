import { createAuthService } from "./auth";
import { loadConfig } from "./config";
import { createUploadStorage } from "./storage";

async function initializeRuntime() {
  const config = loadConfig();
  const storage = createUploadStorage(config);
  await storage.initialize();
  const authService = await createAuthService(config);

  return {
    authService,
    config,
    storage,
  };
}

let runtimePromise: ReturnType<typeof initializeRuntime> | undefined;

export function getRuntime(): ReturnType<typeof initializeRuntime> {
  runtimePromise ??= initializeRuntime();
  return runtimePromise;
}
