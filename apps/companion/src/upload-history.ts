import type { BackgroundUploadEntry } from "../modules/fairth-background-upload";

export type UploadHistoryGroups = Readonly<{
  failures: readonly BackgroundUploadEntry[];
  active: readonly BackgroundUploadEntry[];
  completed: readonly BackgroundUploadEntry[];
}>;

export function groupUploadHistory(entries: readonly BackgroundUploadEntry[]): UploadHistoryGroups {
  return {
    failures: entries.filter((entry) => entry.status === "retry"),
    active: entries.filter((entry) => entry.status === "pending" || entry.status === "uploading"),
    completed: entries.filter((entry) => entry.status === "uploaded"),
  };
}

function shortDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

export function uploadEntryDetail(entry: BackgroundUploadEntry, now = Date.now()): string {
  if (entry.status === "uploading") return "Uploading now";
  if (entry.status === "pending") return "Waiting to upload";
  if (entry.status === "retry") {
    return entry.nextAttemptAt > now ? `Automatic retry in ${shortDuration(entry.nextAttemptAt - now)}` : "Ready to retry";
  }

  const age = Math.max(0, now - entry.updatedAt);
  if (age < 60_000) return "Uploaded just now";
  if (age < 7 * 24 * 60 * 60_000) return `Uploaded ${shortDuration(age)} ago`;
  return `Uploaded ${new Date(entry.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

export function uploadFailureDetail(error: string | null): string {
  if (error === null || error.trim().length === 0) return "The upload stopped before it finished.";
  return error.replace(/^Upload failed:\s*/i, "");
}
