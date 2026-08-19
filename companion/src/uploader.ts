import NetInfo, { NetInfoStateType } from "@react-native-community/netinfo";
import * as Battery from "expo-battery";
import { fetch } from "expo/fetch";
import { File, FileMode } from "expo-file-system";
import { getToken } from "./credentials";
import { nextQueueItem, updateQueue } from "./database";
import type { QueueItem, SyncResult, SyncSettings } from "./types";

type SessionState = Readonly<{ uploadId: string; chunkSize: number; receivedChunks: readonly number[] }>;
type UploadResult = Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>;

function endpoint(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function sessionState(value: unknown): SessionState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = Object.fromEntries(Object.entries(value));
  if (typeof record.uploadId !== "string" || typeof record.chunkSize !== "number" || !Array.isArray(record.receivedChunks)) return undefined;
  const receivedChunks = record.receivedChunks.filter((chunk): chunk is number => typeof chunk === "number" && Number.isSafeInteger(chunk));
  return { uploadId: record.uploadId, chunkSize: record.chunkSize, receivedChunks };
}

async function json(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return undefined; }
}

async function apiMessage(response: Response): Promise<string> {
  const value = await json(response);
  if (typeof value === "object" && value !== null) {
    const record = Object.fromEntries(Object.entries(value));
    if (typeof record.message === "string") return record.message;
  }
  return `Ingestion API returned HTTP ${response.status}.`;
}

function inWindow(settings: SyncSettings, date = new Date()): boolean {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (settings.windowStart === settings.windowEnd) return true;
  if (settings.windowStart < settings.windowEnd) return hour >= settings.windowStart && hour < settings.windowEnd;
  return hour >= settings.windowStart || hour < settings.windowEnd;
}

async function constraints(settings: SyncSettings): Promise<UploadResult> {
  if (!inWindow(settings)) return { ok: false, message: "Waiting for the configured sync window." };
  const network = await NetInfo.fetch();
  if (!network.isConnected) return { ok: false, message: "Offline. Uploads remain queued." };
  if (settings.wifiOnly && network.type !== NetInfoStateType.wifi) return { ok: false, message: "Waiting for Wi-Fi." };
  if (settings.chargingOnly) {
    const state = await Battery.getBatteryStateAsync();
    if (state !== Battery.BatteryState.CHARGING && state !== Battery.BatteryState.FULL) {
      return { ok: false, message: "Waiting for the device to charge." };
    }
  }
  return { ok: true };
}

async function reachable(candidate: string): Promise<boolean> {
  if (candidate.length === 0) return false;
  try {
    const response = await fetch(`${candidate}/health`, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function chooseEndpoint(settings: SyncSettings): Promise<string | undefined> {
  const lan = endpoint(settings.lanEndpoint);
  if (await reachable(lan)) return lan;
  const primary = endpoint(settings.primaryEndpoint);
  if (await reachable(primary)) return primary;
  return undefined;
}

async function startSession(base: string, token: string, deviceId: string, item: QueueItem, size: number): Promise<SessionState | undefined> {
  const response = await fetch(`${base}/v1/uploads`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      filename: item.filename,
      size,
      metadata: { deviceId, album: item.album, capturedAt: new Date(item.createdAt).toISOString() },
    }),
  });
  if (!response.ok) return undefined;
  return sessionState(await json(response));
}

async function resumeSession(base: string, token: string, uploadId: string): Promise<SessionState | undefined> {
  const response = await fetch(`${base}/v1/uploads/${uploadId}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return undefined;
  return sessionState(await json(response));
}

async function uploadOne(base: string, token: string, deviceId: string, item: QueueItem): Promise<UploadResult> {
  try {
    const file = new File(item.uri);
    if (!file.exists || file.size <= 0) return { ok: false, message: `${item.filename} is no longer readable on this device.` };
    let session = item.uploadId === undefined ? undefined : await resumeSession(base, token, item.uploadId);
    if (session === undefined) session = await startSession(base, token, deviceId, item, file.size);
    if (session === undefined) return { ok: false, message: "The ingestion API could not create or resume the upload session." };
    await updateQueue(item.assetId, { status: "uploading", uploadId: session.uploadId, error: null });
    const received = new Set(session.receivedChunks);
    const count = Math.ceil(file.size / session.chunkSize);
    const handle = file.open(FileMode.ReadOnly);
    try {
      for (let index = 0; index < count; index += 1) {
        if (received.has(index)) continue;
        const start = index * session.chunkSize;
        handle.offset = start;
        const chunk = handle.readBytes(Math.min(session.chunkSize, file.size - start));
        const response = await fetch(`${base}/v1/uploads/${session.uploadId}/chunks/${index}`, {
          method: "PUT",
          headers: { authorization: `Bearer ${token}`, "content-length": String(chunk.byteLength) },
          body: chunk,
        });
        if (!response.ok) return { ok: false, message: await apiMessage(response) };
      }
    } finally {
      handle.close();
    }
    const completion = await fetch(`${base}/v1/uploads/${session.uploadId}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-length": "0" },
    });
    if (!completion.ok) return { ok: false, message: await apiMessage(completion) };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Unknown upload failure." };
  }
}

function nextRetry(attempt: number): number {
  return Date.now() + Math.min(6 * 60 * 60_000, 15_000 * (2 ** Math.min(attempt, 10)));
}

export async function drainQueue(settings: SyncSettings, maximum = 20): Promise<SyncResult> {
  const allowed = await constraints(settings);
  if (!allowed.ok) return { ok: false, uploaded: 0, queued: 0, message: allowed.message };
  const token = await getToken();
  if (token === undefined) return { ok: false, uploaded: 0, queued: 0, message: "Save the ingestion token before syncing." };
  const base = await chooseEndpoint(settings);
  if (base === undefined) return { ok: false, uploaded: 0, queued: 0, message: "Neither the LAN nor remote ingestion endpoint is reachable." };

  let uploaded = 0;
  let processed = 0;
  let lastFailure: string | undefined;
  while (processed < maximum) {
    const item = await nextQueueItem();
    if (item === undefined) break;
    processed += 1;
    const result = await uploadOne(base, token, settings.deviceId, item);
    if (result.ok) {
      uploaded += 1;
      await updateQueue(item.assetId, { status: "uploaded", uploadId: null, error: null });
    } else {
      const attempts = item.attempts + 1;
      lastFailure = result.message;
      await updateQueue(item.assetId, { status: "retry", attempts, nextAttemptAt: nextRetry(attempts), error: result.message });
    }
  }
  const retrying = processed - uploaded;
  if (lastFailure !== undefined) {
    const uploadedMessage = uploaded === 0 ? "" : `Uploaded ${uploaded} item${uploaded === 1 ? "" : "s"}. `;
    return {
      ok: false,
      uploaded,
      queued: retrying,
      message: `${uploadedMessage}${retrying} item${retrying === 1 ? "" : "s"} will retry. Last error: ${lastFailure}`,
    };
  }
  return {
    ok: true,
    uploaded,
    queued: 0,
    message: uploaded === 0 ? "Queue is up to date." : `Uploaded ${uploaded} item${uploaded === 1 ? "" : "s"}.`,
  };
}
