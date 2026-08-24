import { getRuntime } from "./runtime";
import { createUploadApi } from "./upload-api";

export async function getUploadApi() {
  const { authService, companionPresence, config, storage } = await getRuntime();
  return createUploadApi(config, storage, authService, undefined, companionPresence);
}
