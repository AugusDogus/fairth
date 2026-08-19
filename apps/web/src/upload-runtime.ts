import { getRuntime } from "./runtime";
import { createUploadApi } from "./upload-api";

export async function getUploadApi() {
  const { authService, config, storage } = await getRuntime();
  return createUploadApi(config, storage, authService);
}
