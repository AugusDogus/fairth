import BackgroundUpload, { type BackgroundUploadStatus } from "../modules/fairth-background-upload";
import { getToken } from "./credentials";
import type { SyncSettings } from "./types";

export async function configureBackgroundSync(settings: SyncSettings, token?: string): Promise<void> {
  const enrolledToken = token ?? await getToken();
  if (enrolledToken === undefined) {
    if (settings.automaticSync) throw new Error("Enroll this phone before enabling automatic uploads.");
    return;
  }
  await BackgroundUpload.configure(JSON.stringify(settings), enrolledToken);
}

export async function syncCycle(settings: SyncSettings): Promise<string> {
  const token = await getToken();
  if (token === undefined) throw new Error("Enroll this phone before starting an upload.");
  await configureBackgroundSync(settings, token);
  await BackgroundUpload.runNow();
  return "Android scheduled a media scan and resumable upload run.";
}

export async function uploadStatus(): Promise<BackgroundUploadStatus> {
  return BackgroundUpload.getStatus();
}

export async function checkUploadConnection(): Promise<boolean> {
  return BackgroundUpload.checkConnection();
}
