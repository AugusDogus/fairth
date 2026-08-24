import type { GooglePhotosProgress } from "@fairth/android-rpc";

export type UiBounds = Readonly<{ left: number; top: number; right: number; bottom: number }>;

export type UiNode = Readonly<{
  text: string;
  resourceId: string;
  packageName: string;
  contentDescription: string;
  clickable: boolean;
  checked: boolean;
  enabled: boolean;
  bounds: UiBounds;
}>;

export type PhotosUiDecision =
  | Readonly<{ kind: "complete" }>
  | Readonly<{ kind: "tap"; x: number; y: number; description: string }>
  | Readonly<{ kind: "wait" }>;

export type GooglePhotosUiStatus = "enabled" | "disabled" | "blocked" | "unknown";

function notificationNumber(output: string, name: string): number | undefined {
  const match = new RegExp(`android\\.${name}\\s*[=:]\\s*(\\d+)`, "i").exec(output);
  if (match?.[1] === undefined) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function parseGooglePhotosNotification(output: string): GooglePhotosProgress | undefined {
  if (!output.includes("com.google.android.apps.photos")) return undefined;
  const normalized = output.replaceAll(/\s+/g, " ").trim();
  if (/backup (?:is )?off|backup stopped/i.test(normalized)) {
    return { state: "needs_setup", detail: "Google Photos reports that backup is off." };
  }
  if (/storage (?:is )?full|out of storage|backup paused|waiting for wi-?fi/i.test(normalized)) {
    const reason = /storage (?:is )?full|out of storage/i.test(normalized)
      ? "Google Photos backup is blocked because the Google account storage is full."
      : "Google Photos reports that backup is paused.";
    return { state: "blocked", detail: reason };
  }
  if (!/backing up|uploading/i.test(normalized)) return undefined;

  const completed = notificationNumber(output, "progress");
  const total = notificationNumber(output, "progressMax");
  const remainingMatch = /(\d+)\s+(?:items?\s+)?(?:left|remaining)/i.exec(normalized);
  const remaining = remainingMatch?.[1] === undefined ? undefined : Number(remainingMatch[1]);
  return {
    state: "uploading",
    detail: "Google Photos is actively backing up the emulated camera roll.",
    ...(completed === undefined ? {} : { completed }),
    ...(total === undefined ? {} : { total }),
    ...(remaining === undefined || !Number.isSafeInteger(remaining) ? {} : { remaining }),
  };
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hexadecimal: string) => String.fromCodePoint(Number.parseInt(hexadecimal, 16)));
}

function attribute(node: string, name: string): string {
  return decodeXml(new RegExp(`\\b${name}="([^"]*)"`).exec(node)?.[1] ?? "");
}

function parseBounds(value: string): UiBounds | undefined {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(value);
  if (match === null) return undefined;
  const coordinates = match.slice(1).map(Number);
  const [left, top, right, bottom] = coordinates;
  if (left === undefined || top === undefined || right === undefined || bottom === undefined) return undefined;
  return { left, top, right, bottom };
}

export function parseUiNodes(xml: string): readonly UiNode[] {
  const nodes: UiNode[] = [];
  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const source = match[0];
    const bounds = parseBounds(attribute(source, "bounds"));
    if (bounds === undefined) continue;
    nodes.push({
      text: attribute(source, "text"),
      resourceId: attribute(source, "resource-id"),
      packageName: attribute(source, "package"),
      contentDescription: attribute(source, "content-desc"),
      clickable: attribute(source, "clickable") === "true",
      checked: attribute(source, "checked") === "true",
      enabled: attribute(source, "enabled") === "true",
      bounds,
    });
  }
  return nodes;
}

function center(bounds: UiBounds): Readonly<{ x: number; y: number }> {
  return { x: Math.floor((bounds.left + bounds.right) / 2), y: Math.floor((bounds.top + bounds.bottom) / 2) };
}

function area(bounds: UiBounds): number {
  return (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
}

function contains(outer: UiBounds, inner: UiBounds): boolean {
  return outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom;
}

function tappableNode(nodes: readonly UiNode[], target: UiNode): UiNode {
  return nodes
    .filter((node) => node.clickable && node.enabled && contains(node.bounds, target.bounds))
    .sort((left, right) => area(left.bounds) - area(right.bounds))[0] ?? target;
}

function tap(nodes: readonly UiNode[], target: UiNode, description: string): PhotosUiDecision {
  return { kind: "tap", ...center(tappableNode(nodes, target).bounds), description };
}

function exactText(nodes: readonly UiNode[], value: string): UiNode | undefined {
  return nodes.find((node) => node.enabled && node.text.trim().toLocaleLowerCase() === value.toLocaleLowerCase());
}

function idEndsWith(nodes: readonly UiNode[], value: string): UiNode | undefined {
  return nodes.find((node) => node.enabled && node.resourceId.endsWith(value));
}

function allCopy(nodes: readonly UiNode[]): string {
  return nodes.map((node) => `${node.text}\n${node.contentDescription}`).join("\n");
}

function reportsActiveBackup(node: UiNode): boolean {
  return (node.resourceId.endsWith(":id/photos_autobackup_particle_status_title")
      && /^(backup complete|backing up|getting ready to back up)$/i.test(node.text.trim()))
    || (node.resourceId.endsWith(":id/summary") && /^backing up to\b/i.test(node.text.trim()))
    || (node.resourceId.endsWith(":id/selected_account_disc")
      && /(?:^|\n)(?:backup complete|backing up|get(?:ting)? ready to back up)\.?\s*(?:\n|$)/i.test(node.contentDescription));
}

export function googlePhotosUiStatus(nodes: readonly UiNode[]): GooglePhotosUiStatus {
  const photosNodes = nodes.filter((node) => node.packageName === "com.google.android.apps.photos");
  if (photosNodes.length === 0) return "unknown";
  const copy = allCopy(photosNodes);
  if (/storage (?:is )?full|out of storage|backup paused/i.test(copy)) return "blocked";
  const backupSwitch = idEndsWith(photosNodes, ":id/switchWidget");
  if (backupSwitch !== undefined) return backupSwitch.checked ? "enabled" : "disabled";
  if (/\bbackup (?:is )?off\b|\bbackup stopped\b/i.test(copy)) return "disabled";
  if (photosNodes.some(reportsActiveBackup)) return "enabled";
  return "unknown";
}

export function nextPhotosUiDecision(nodes: readonly UiNode[]): PhotosUiDecision {
  const backupSwitch = idEndsWith(nodes, ":id/switchWidget");
  if (backupSwitch?.checked === true) return { kind: "complete" };

  const activeStatus = nodes.some(reportsActiveBackup);
  if (activeStatus) return { kind: "complete" };

  const welcomeSkip = idEndsWith(nodes, ":id/welcomescreens_skip_button");
  if (welcomeSkip !== undefined) return tap(nodes, welcomeSkip, "skip the Google Photos welcome tour");

  const notNow = exactText(nodes, "Not now");
  if (notNow !== undefined) return tap(nodes, notNow, "dismiss the Google Photos update prompt");

  const permissionPackages = new Set(["com.android.permissioncontroller", "com.google.android.permissioncontroller"]);
  const permissionUi = nodes.some((node) => permissionPackages.has(node.packageName));
  const permissionAllow = nodes.find((node) => permissionPackages.has(node.packageName)
    && node.enabled
    && (node.resourceId.endsWith(":id/permission_allow_button") || node.resourceId.endsWith(":id/permission_allow_foreground_only_button")));
  if (permissionUi && /photos/i.test(allCopy(nodes)) && permissionAllow !== undefined) {
    return tap(nodes, permissionAllow, "allow Google Photos to access this phone's media");
  }

  const turnOn = exactText(nodes, "Turn on backup") ?? exactText(nodes, "Turn on Back up & sync");
  if (turnOn !== undefined) return tap(nodes, turnOn, "turn on Google Photos backup");

  const confirm = exactText(nodes, "Confirm");
  if (confirm !== undefined && /back(?:up| up)|backup quality/i.test(allCopy(nodes))) {
    return tap(nodes, confirm, "confirm Google Photos backup");
  }

  if (backupSwitch !== undefined && !backupSwitch.checked) {
    return tap(nodes, backupSwitch, "enable the Google Photos backup switch");
  }

  const backupSettings = exactText(nodes, "Back up & sync") ?? exactText(nodes, "Backup");
  if (backupSettings !== undefined) return tap(nodes, backupSettings, "open Google Photos backup settings");

  const photosSettings = exactText(nodes, "Photos settings");
  if (photosSettings !== undefined) return tap(nodes, photosSettings, "open Google Photos settings");

  const disabledStatus = nodes.find((node) => node.enabled && /\bbackup (?:stopped|is off)\b/i.test(node.contentDescription));
  if (disabledStatus !== undefined) return tap(nodes, disabledStatus, "open the stopped Google Photos backup status");

  const accountButton = idEndsWith(nodes, ":id/selected_account_disc");
  if (accountButton !== undefined) return tap(nodes, accountButton, "open Google Photos account settings");

  return { kind: "wait" };
}
