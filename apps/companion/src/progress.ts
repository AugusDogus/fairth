import type { SyncSettings } from "./types";

export type GooglePhotosProgress =
  | Readonly<{ state: "needs_setup"; detail: string }>
  | Readonly<{ state: "idle"; detail: string }>
  | Readonly<{ state: "uploading"; detail: string; completed?: number; total?: number; remaining?: number }>
  | Readonly<{ state: "blocked"; detail: string }>;

export type ApplianceProgress = Readonly<{
  imports: Readonly<{ pending: number; imported: number; failed: number; duplicate: number }>;
  googlePhotos: GooglePhotosProgress;
}>;

export type ImportSummary = Readonly<{
  duplicates: number;
  failed: number;
  pending: number;
  processed: number;
  total: number;
}>;

export function summarizeImports(imports: ApplianceProgress["imports"]): ImportSummary {
  const processed = imports.imported + imports.duplicate;
  return {
    duplicates: imports.duplicate,
    failed: imports.failed,
    pending: imports.pending,
    processed,
    total: processed + imports.pending + imports.failed,
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseGooglePhotos(value: unknown): GooglePhotosProgress | undefined {
  const status = record(value);
  if (status === undefined || typeof status.detail !== "string") return undefined;
  if (status.state === "needs_setup" || status.state === "idle" || status.state === "blocked") {
    return { state: status.state, detail: status.detail };
  }
  if (status.state !== "uploading") return undefined;
  const completed = count(status.completed);
  const total = count(status.total);
  const remaining = count(status.remaining);
  return {
    state: "uploading",
    detail: status.detail,
    ...(completed === undefined ? {} : { completed }),
    ...(total === undefined ? {} : { total }),
    ...(remaining === undefined ? {} : { remaining }),
  };
}

export function parseApplianceProgress(value: unknown): ApplianceProgress | undefined {
  const response = record(value);
  const imports = record(response?.imports);
  const googlePhotos = parseGooglePhotos(response?.googlePhotos);
  const pending = count(imports?.pending);
  const imported = count(imports?.imported);
  const failed = count(imports?.failed);
  const duplicate = count(imports?.duplicate);
  if (pending === undefined || imported === undefined || failed === undefined || duplicate === undefined || googlePhotos === undefined) {
    return undefined;
  }
  return { imports: { pending, imported, failed, duplicate }, googlePhotos };
}

function endpoints(settings: SyncSettings): readonly string[] {
  return [...new Set([settings.lanEndpoint, settings.primaryEndpoint].map((value) => value.trim().replace(/\/$/, "")).filter(Boolean))];
}

export async function loadApplianceProgress(settings: SyncSettings, token: string): Promise<ApplianceProgress | undefined> {
  for (const endpoint of endpoints(settings)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const response = await fetch(`${endpoint}/v1/status`, {
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (!response.ok) continue;
      const parsed = parseApplianceProgress(await response.json());
      if (parsed !== undefined) return parsed;
    } catch {
      // Try the next route to the same appliance.
    }
  }
  return undefined;
}
