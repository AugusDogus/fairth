export type SyncSettings = Readonly<{
  primaryEndpoint: string;
  lanEndpoint: string;
  deviceId: string;
  wifiOnly: boolean;
  chargingOnly: boolean;
  automaticSync: boolean;
  windowStart: number;
  windowEnd: number;
  albumIds: readonly string[];
}>;

export type QueueStatus = "pending" | "uploading" | "retry" | "uploaded";

export type QueueItem = Readonly<{
  assetId: string;
  uri: string;
  filename: string;
  mediaType: "photo" | "video";
  createdAt: number;
  album: string;
  status: QueueStatus;
  attempts: number;
  nextAttemptAt: number;
  uploadId?: string;
  error?: string;
}>;

export type SyncResult =
  | Readonly<{ ok: true; uploaded: number; queued: number; message: string }>
  | Readonly<{ ok: false; uploaded: number; queued: number; message: string }>;

export const defaultSettings: SyncSettings = {
  primaryEndpoint: "",
  lanEndpoint: "http://unraid.local:3000",
  deviceId: "pixel",
  wifiOnly: true,
  chargingOnly: false,
  automaticSync: false,
  windowStart: 0,
  windowEnd: 24,
  albumIds: [],
};
