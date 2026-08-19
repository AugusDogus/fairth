import { createApp } from "./app";
import { createAuthService } from "./auth";
import { loadConfig } from "./config";
import { createUploadStorage } from "./storage";

async function initializeRuntime() {
  const config = loadConfig();
  const storage = createUploadStorage(config);
  await storage.initialize();
  const authService = await createAuthService(config);

  return {
    app: createApp(config, storage, authService),
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
