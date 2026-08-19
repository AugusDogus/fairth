import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { initializeDatabase, loadSettings } from "./database";
import { detectNewMedia } from "./media";
import { drainQueue } from "./uploader";
import type { SyncResult } from "./types";

const TASK_NAME = "fairth-background-sync";
let active = false;

export async function syncCycle(): Promise<SyncResult> {
  if (active) return { ok: true, uploaded: 0, queued: 0, message: "A sync is already running." };
  active = true;
  try {
    await initializeDatabase();
    const settings = await loadSettings();
    await detectNewMedia(settings);
    return await drainQueue(settings);
  } catch (error) {
    return { ok: false, uploaded: 0, queued: 0, message: error instanceof Error ? error.message : "Unknown sync failure." };
  } finally {
    active = false;
  }
}

TaskManager.defineTask(TASK_NAME, async () => {
  const result = await syncCycle();
  return result.ok ? BackgroundTask.BackgroundTaskResult.Success : BackgroundTask.BackgroundTaskResult.Failed;
});

export async function configureBackgroundSync(enabled: boolean): Promise<void> {
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (enabled && !registered) await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 15 });
  if (!enabled && registered) await BackgroundTask.unregisterTaskAsync(TASK_NAME);
}
