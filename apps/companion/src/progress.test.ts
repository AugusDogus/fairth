import { describe, expect, test } from "bun:test";
import { parseApplianceProgress, summarizeImports } from "./progress";

describe("pipeline progress", () => {
  test("keeps appliance import and Google Photos progress separate", () => {
    expect(parseApplianceProgress({
      imports: { pending: 2, imported: 7, failed: 1, duplicate: 0 },
      googlePhotos: { state: "uploading", detail: "Backing up.", completed: 4, total: 7, remaining: 3 },
    })).toEqual({
      imports: { pending: 2, imported: 7, failed: 1, duplicate: 0 },
      googlePhotos: { state: "uploading", detail: "Backing up.", completed: 4, total: 7, remaining: 3 },
    });
  });

  test("rejects success-shaped responses with invalid counts", () => {
    expect(parseApplianceProgress({
      imports: { pending: -1, imported: 7, failed: 0, duplicate: 0 },
      googlePhotos: { state: "idle", detail: "Idle." },
    })).toBeUndefined();
  });

  test("summarizes appliance imports without mixing in phone-local totals", () => {
    expect(summarizeImports({ pending: 0, imported: 2, failed: 0, duplicate: 2 })).toEqual({
      duplicates: 2,
      failed: 0,
      pending: 0,
      processed: 4,
      total: 4,
    });
  });
});
