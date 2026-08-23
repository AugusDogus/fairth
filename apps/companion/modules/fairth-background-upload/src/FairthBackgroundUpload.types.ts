export type BackgroundUploadStatus = Readonly<{
  pending: number;
  retry: number;
  uploaded: number;
  eligible: number;
  lastRunAt: number;
  lastError: string;
}>;

export type BackgroundUploadEntryStatus = "pending" | "uploading" | "retry" | "uploaded";

export type BackgroundUploadEntry = Readonly<{
  id: string;
  uri: string;
  filename: string;
  status: BackgroundUploadEntryStatus;
  capturedAt: number;
  updatedAt: number;
  nextAttemptAt: number;
  lastError: string | null;
  attempts: number;
}>;
