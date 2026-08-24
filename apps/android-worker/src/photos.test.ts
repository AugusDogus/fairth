import { describe, expect, test } from "bun:test";
import { googlePhotosUiStatus, nextPhotosUiDecision, parseGooglePhotosNotification, parseUiNodes } from "./photos.js";

const photosPackage = "com.google.android.apps.photos";

function hierarchy(nodes: string): string {
  return `<?xml version='1.0'?><hierarchy>${nodes}</hierarchy>`;
}

function node(attributes: string): string {
  return `<node ${attributes} text="" resource-id="" package="${photosPackage}" content-desc="" clickable="false" checked="false" enabled="true" bounds="[0,0][100,100]"/>`;
}

describe("Google Photos UI parsing", () => {
  test("decodes text and bounds without retaining account-specific markup", () => {
    const nodes = parseUiNodes(hierarchy(node('text="Back up &amp; sync" bounds="[10,20][110,220]"')));

    expect(nodes[0]).toMatchObject({ text: "Back up & sync", bounds: { left: 10, top: 20, right: 110, bottom: 220 } });
  });

  test("distinguishes a disabled switch from an enabled one", () => {
    const disabled = parseUiNodes(hierarchy(node('resource-id="com.google.android.apps.photos:id/switchWidget" checked="false"')));
    const enabled = parseUiNodes(hierarchy(node('resource-id="com.google.android.apps.photos:id/switchWidget" checked="true"')));

    expect(googlePhotosUiStatus(disabled)).toBe("disabled");
    expect(googlePhotosUiStatus(enabled)).toBe("enabled");
  });
});

describe("Google Photos setup decisions", () => {
  test("skips the first-run tour", () => {
    const nodes = parseUiNodes(hierarchy(node('resource-id="com.google.android.apps.photos:id/welcomescreens_skip_button" text="Skip" clickable="true" bounds="[20,80][80,100]"')));

    expect(nextPhotosUiDecision(nodes)).toEqual({ kind: "tap", x: 50, y: 90, description: "skip the Google Photos welcome tour" });
  });

  test("recognizes the account badge backup status as complete", () => {
    const nodes = parseUiNodes(hierarchy(node('resource-id="com.google.android.apps.photos:id/selected_account_disc" content-desc="Signed in as owner@example.com&#10;Backing up.&#10;Account and settings."')));

    expect(nextPhotosUiDecision(nodes)).toEqual({ kind: "complete" });
  });

  test("recognizes the checked backup switch as complete", () => {
    const nodes = parseUiNodes(hierarchy(node('resource-id="com.google.android.apps.photos:id/switchWidget" checked="true"')));

    expect(nextPhotosUiDecision(nodes)).toEqual({ kind: "complete" });
  });

  test("recognizes an active backup summary as complete", () => {
    const nodes = parseUiNodes(hierarchy(node('resource-id="com.google.android.apps.photos:id/summary" text="Backing up to owner@example.com"')));

    expect(nextPhotosUiDecision(nodes)).toEqual({ kind: "complete" });
  });

  test("dismisses the update prompt before navigating settings", () => {
    const nodes = parseUiNodes(hierarchy(node('resource-id="com.google.android.apps.photos:id/negative_button" text="Not now" clickable="true" bounds="[20,80][80,100]"')));

    expect(nextPhotosUiDecision(nodes)).toEqual({ kind: "tap", x: 50, y: 90, description: "dismiss the Google Photos update prompt" });
  });

  test("opens the account menu when backup reports stopped", () => {
    const nodes = parseUiNodes(hierarchy(node('resource-id="com.google.android.apps.photos:id/selected_account_disc" content-desc="Backup stopped. Account and settings." clickable="true" bounds="[80,0][100,20]"')));

    expect(nextPhotosUiDecision(nodes)).toEqual({ kind: "tap", x: 90, y: 10, description: "open the stopped Google Photos backup status" });
  });

  test("enables an unchecked backup switch", () => {
    const nodes = parseUiNodes(hierarchy([
      node('clickable="true" bounds="[0,0][100,50]"'),
      node('resource-id="com.google.android.apps.photos:id/switchWidget" checked="false" bounds="[80,10][100,40]"'),
    ].join("")));

    expect(nextPhotosUiDecision(nodes)).toEqual({ kind: "tap", x: 50, y: 25, description: "enable the Google Photos backup switch" });
  });
});

describe("Google Photos backup progress", () => {
  test("reads numeric progress from the active Photos notification", () => {
    const notification = `NotificationRecord pkg=com.google.android.apps.photos
      android.title=Backing up
      android.text=3 items left
      android.progress=7
      android.progressMax=10`;

    expect(parseGooglePhotosNotification(notification)).toEqual({
      state: "uploading",
      detail: "Google Photos is actively backing up the emulated camera roll.",
      completed: 7,
      total: 10,
      remaining: 3,
    });
  });

  test("reports a full account as blocked instead of complete", () => {
    const notification = "NotificationRecord pkg=com.google.android.apps.photos android.text=Account storage is full";

    expect(parseGooglePhotosNotification(notification)).toEqual({
      state: "blocked",
      detail: "Google Photos backup is blocked because the Google account storage is full.",
    });
  });
});
