import { describe, expect, test } from "bun:test";
import type { BackgroundUploadEntry } from "../modules/fairth-background-upload";
import { groupUploadHistory, uploadEntryDetail, uploadFailureDetail } from "./upload-history";

function entry(status: BackgroundUploadEntry["status"], overrides: Partial<BackgroundUploadEntry> = {}): BackgroundUploadEntry {
  return {
    attempts: 0,
    capturedAt: 1,
    filename: `${status}.jpg`,
    id: status,
    uri: `content://photos/${status}`,
    lastError: null,
    nextAttemptAt: 0,
    status,
    updatedAt: 1,
    ...overrides,
  };
}

describe("upload history", () => {
  test("groups failures, active work, and completed uploads", () => {
    const groups = groupUploadHistory([
      entry("uploaded"),
      entry("pending"),
      entry("retry"),
      entry("uploading"),
    ]);

    expect(groups.failures.map((item) => item.status)).toEqual(["retry"]);
    expect(groups.active.map((item) => item.status)).toEqual(["pending", "uploading"]);
    expect(groups.completed.map((item) => item.status)).toEqual(["uploaded"]);
  });

  test("describes upload and retry timing", () => {
    const now = 10 * 60_000;
    expect(uploadEntryDetail(entry("uploaded", { updatedAt: now - 2 * 60_000 }), now)).toBe("Uploaded 2m ago");
    expect(uploadEntryDetail(entry("retry", { nextAttemptAt: now + 5 * 60_000 }), now)).toBe("Automatic retry in 5m");
    expect(uploadEntryDetail(entry("pending"), now)).toBe("Waiting to upload");
  });

  test("removes redundant upload failure prefixes", () => {
    expect(uploadFailureDetail("Upload failed: Connection reset")).toBe("Connection reset");
    expect(uploadFailureDetail(null)).toBe("The upload stopped before it finished.");
  });
});
