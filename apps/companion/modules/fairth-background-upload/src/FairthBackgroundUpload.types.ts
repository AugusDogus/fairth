export type BackgroundUploadStatus = Readonly<{
  pending: number;
  retry: number;
  uploaded: number;
  eligible: number;
  lastRunAt: number;
  lastError: string;
}>;
