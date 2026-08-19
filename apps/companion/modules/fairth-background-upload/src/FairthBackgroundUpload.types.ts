export type BackgroundUploadStatus = Readonly<{
  pending: number;
  retry: number;
  uploaded: number;
  lastRunAt: number;
  lastError: string;
}>;
