import { spawn } from "node:child_process";
import { access, rm, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AndroidAction, AndroidOnboarding, AndroidStep, GooglePhotosProgress } from "@fairth/android-rpc";
import type { Config } from "./config.js";
import { googlePhotosUiStatus, nextPhotosUiDecision, parseGooglePhotosNotification, parseUiNodes } from "./photos.js";

export type CommandResult =
  | Readonly<{ ok: true; stdout: string; stderr: string }>
  | Readonly<{ ok: false; message: string; stdout: string; stderr: string }>;

export function pixelMaskPreferencesReady(preferences: string): boolean {
  const moduleDisabled = /<boolean[^>]*name="PREF_MODULE_ENABLED"[^>]*value="false"/.test(preferences);
  const hasSpoofTarget = preferences.includes("name=\"PREF_DEVICE_TO_SPOOF\"");
  const originalPixelSelected = !hasSpoofTarget || /<string[^>]*name="PREF_DEVICE_TO_SPOOF"[^>]*>Pixel<\/string>/.test(preferences);
  return !moduleDisabled && originalPixelSelected;
}

export function googleAccountPresent(accounts: string): boolean {
  return /(?:^|\n)\s*Account \{name=[^}]+,\s*type=com\.google\}\s*(?:\n|$)/.test(accounts);
}

export function onboardingActionArgs(action: AndroidAction): readonly string[] {
  if (action === "open_google_account") return ["shell", "am", "start", "-a", "android.settings.ADD_ACCOUNT_SETTINGS"];
  return [];
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function capturedAtTouchScript(destination: string, capturedAtMs: number): string {
  const epochSeconds = Math.floor(capturedAtMs / 1_000);
  return `touch -m -d ${shellQuote(`@${epochSeconds}`)} ${shellQuote(destination)}`;
}

export function destinationDigestScript(destination: string): string {
  return `if test -f ${shellQuote(destination)}; then sha256sum ${shellQuote(destination)}; else printf missing; fi`;
}

export function destinationDigestMatches(output: string, expectedSha256: string): boolean {
  return output.split(/\s+/, 1)[0] === expectedSha256;
}

async function run(command: string, args: readonly string[], timeoutMs = 30_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, message: `Could not start ${command}: ${error.message}`, stdout: "", stderr: "" });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errors = Buffer.concat(stderr).toString("utf8").trim();
      if (code === 0) resolve({ ok: true, stdout: output, stderr: errors });
      else resolve({ ok: false, message: `${command} exited with ${code ?? signal ?? "unknown status"}.`, stdout: output, stderr: errors });
    });
  });
}

export function createAdb(config: Config) {
  const photosReadyPath = `${config.dataDirectory}/photos-backup-ready`;
  const pixelMaskActivePath = `${config.provisioningStateDirectory}/pixelmask-active`;

  async function command(args: readonly string[], timeoutMs?: number): Promise<CommandResult> {
    await run("adb", ["connect", config.adbEndpoint], 10_000);
    return run("adb", ["-s", config.adbEndpoint, ...args], timeoutMs);
  }

  async function health(): Promise<Readonly<{ connected: boolean; booted: boolean; photosInstalled: boolean }>> {
    const state = await command(["get-state"]);
    if (!state.ok || state.stdout !== "device") return { connected: false, booted: false, photosInstalled: false };
    const boot = await command(["shell", "getprop", "sys.boot_completed"]);
    const photos = await command(["shell", "pm", "path", config.googlePhotosPackage]);
    return {
      connected: true,
      booted: boot.ok && boot.stdout === "1",
      photosInstalled: photos.ok && photos.stdout.startsWith("package:"),
    };
  }

  async function packageInstalled(packageName: string): Promise<boolean> {
    const result = await command(["shell", "pm", "path", packageName]);
    return result.ok && result.stdout.startsWith("package:");
  }

  async function rootShell(script: string): Promise<CommandResult> {
    return command(["shell", `su 0 sh -c ${shellQuote(script)}`]);
  }

  async function photosSetupReady(): Promise<boolean> {
    try {
      await access(photosReadyPath);
      return true;
    } catch {
      return false;
    }
  }

  async function pixelMaskActive(): Promise<boolean> {
    try {
      await access(pixelMaskActivePath);
      return true;
    } catch {
      return false;
    }
  }

  async function googlePhotosProgress(): Promise<GooglePhotosProgress> {
    if (!await photosSetupReady()) {
      return { state: "needs_setup", detail: "Google Photos backup has not been configured on the emulated phone." };
    }
    const hierarchy = await command([
      "shell", "sh", "-c",
      "rm -f /sdcard/fairth-status-window.xml; uiautomator dump /sdcard/fairth-status-window.xml >/dev/null && cat /sdcard/fairth-status-window.xml",
    ], 15_000);
    if (hierarchy.ok) {
      const uiStatus = googlePhotosUiStatus(parseUiNodes(hierarchy.stdout));
      if (uiStatus === "disabled") {
        await rm(photosReadyPath, { force: true });
        return { state: "needs_setup", detail: "Google Photos reports that backup is off." };
      }
      if (uiStatus === "blocked") {
        return { state: "blocked", detail: "Google Photos reports that backup is paused or blocked." };
      }
    }
    const notifications = await command(["shell", "dumpsys", "notification", "--noredact"]);
    if (!notifications.ok) {
      return { state: "idle", detail: "Google Photos backup is enabled, but Android did not expose live transfer progress." };
    }
    const progress = parseGooglePhotosNotification(notifications.stdout);
    if (progress?.state === "needs_setup") await rm(photosReadyPath, { force: true });
    return progress ?? { state: "idle", detail: "Google Photos backup is enabled and is not reporting an active transfer." };
  }

  async function onboarding(): Promise<AndroidOnboarding> {
    const state = await command(["get-state"]);
    const connected = state.ok && state.stdout === "device";
    const boot = connected ? await command(["shell", "getprop", "sys.boot_completed"]) : undefined;
    const booted = boot?.ok === true && boot.stdout === "1";
    if (!booted) {
      return {
        automaticReady: false,
        googleAccountReady: false,
        steps: [{ id: "android", label: "Android", state: "blocked", detail: connected ? "Android is still booting." : "The Android container is not reachable." }],
      };
    }

    const [gmsInstalled, playStoreInstalled, photosInstalled, pixelMaskInstalled, pixelMaskActivated] = await Promise.all([
      packageInstalled("com.google.android.gms"),
      packageInstalled("com.android.vending"),
      packageInstalled(config.googlePhotosPackage),
      packageInstalled("com.kinginu.pixelmask"),
      pixelMaskActive(),
    ]);
    const magisk = await rootShell("/sbin/magisk -v");
    const zygisk = magisk.ok
      ? await rootShell("/sbin/magisk --sqlite 'SELECT value FROM settings WHERE key=\"zygisk\";'")
      : undefined;
    const lsposedDatabase = magisk.ok
      ? await rootShell("test -f /data/adb/lspd/config/modules_config.db")
      : undefined;
    const pixelMaskScope = lsposedDatabase?.ok === true
      ? await rootShell("sqlite3 /data/adb/lspd/config/modules_config.db \"SELECT m.enabled || ':' || COUNT(s.app_pkg_name) FROM modules m LEFT JOIN scope s ON s.mid=m.mid AND s.user_id=0 AND s.app_pkg_name IN ('com.kinginu.pixelmask','com.google.android.apps.photos') WHERE m.module_pkg_name='com.kinginu.pixelmask' GROUP BY m.mid;\"")
      : undefined;
    const pixelMaskPreferences = pixelMaskInstalled
      ? await rootShell("test ! -f /data/user/0/com.kinginu.pixelmask/shared_prefs/prefs.xml || cat /data/user/0/com.kinginu.pixelmask/shared_prefs/prefs.xml")
      : undefined;
    const accounts = await command(["shell", "dumpsys", "account"]);

    const gappsReady = gmsInstalled && playStoreInstalled && photosInstalled;
    const zygiskReady = zygisk?.ok === true && /(?:^|\D)1(?:\D|$)/.test(zygisk.stdout);
    const lsposedReady = lsposedDatabase?.ok === true;
    const preferences = pixelMaskPreferences?.stdout ?? "";
    const pixelMaskReady = pixelMaskInstalled && pixelMaskActivated && pixelMaskScope?.ok === true && pixelMaskScope.stdout === "1:2"
      && pixelMaskPreferences?.ok === true && pixelMaskPreferencesReady(preferences);
    const googleAccountReady = accounts.ok && googleAccountPresent(accounts.stdout);
    const photosProgress = googleAccountReady
      ? await googlePhotosProgress()
      : { state: "needs_setup" as const, detail: "Sign in to Google before configuring Photos backup." };
    const photosReady = photosProgress.state === "idle" || photosProgress.state === "uploading";
    const automaticReady = gappsReady && magisk.ok && zygiskReady && lsposedReady && pixelMaskReady;

    const steps: AndroidStep[] = [
      { id: "android", label: "Android", state: "complete", detail: "Android is connected and fully booted." },
      gappsReady
        ? { id: "gapps", label: "Google apps", state: "complete", detail: "Google Play services, Play Store, and Google Photos are installed." }
        : { id: "gapps", label: "Google apps", state: "blocked", detail: "The Android image must include Google Play services, Play Store, and Google Photos." },
      magisk.ok && zygiskReady
        ? { id: "magisk", label: "Magisk and Zygisk", state: "complete", detail: `Magisk ${magisk.stdout} is available and Zygisk is enabled.` }
        : { id: "magisk", label: "Magisk and Zygisk", state: "blocked", detail: magisk.ok ? "Magisk is installed, but Zygisk is not enabled yet." : "The Android image does not provide working Magisk root access." },
      lsposedReady
        ? { id: "lsposed", label: "LSPosed", state: "complete", detail: "The LSPosed configuration database is available." }
        : { id: "lsposed", label: "LSPosed", state: "blocked", detail: "LSPosed is not installed or has not finished its first boot." },
      pixelMaskReady
        ? { id: "pixelmask", label: "PixelMask", state: "complete", detail: "PixelMask is enabled, uses the original Pixel profile, and is scoped to Google Photos." }
        : { id: "pixelmask", label: "PixelMask", state: "blocked", detail: pixelMaskInstalled ? "PixelMask is installed, but Fairth has not verified that its hook is active in Android." : "PixelMask is not installed." },
      googleAccountReady
        ? { id: "google_account", label: "Google account", state: "complete", detail: "A Google account is signed in inside Android." }
        : { id: "google_account", label: "Google account", state: "action_required", detail: "Google requires you to complete sign-in inside Android.", action: "open_google_account" },
      googleAccountReady && automaticReady && photosReady
        ? { id: "photos", label: "Google Photos", state: "complete", detail: "Fairth verified that Google Photos backup is enabled for this emulated phone." }
        : googleAccountReady && automaticReady && photosProgress.state === "blocked"
        ? { id: "photos", label: "Google Photos", state: "blocked", detail: photosProgress.detail }
        : googleAccountReady && automaticReady
        ? { id: "photos", label: "Google Photos", state: "action_required", detail: "Fairth can configure and verify backup after you complete Google sign-in.", action: "configure_photos" }
        : { id: "photos", label: "Google Photos", state: "blocked", detail: "Finish the preceding setup before configuring Photos backup." },
    ];
    return { automaticReady, googleAccountReady, steps };
  }

  async function onboardingAction(action: AndroidAction): Promise<CommandResult> {
    const args = onboardingActionArgs(action);
    if (args.length === 0) return { ok: false, message: `Android action ${action} must use its dedicated automation flow.`, stdout: "", stderr: "" };
    return command(args);
  }

  async function configurePhotos(): Promise<CommandResult> {
    const launch = await command([
      "shell", "am", "start",
      "-a", "android.intent.action.MAIN",
      "-c", "android.intent.category.LAUNCHER",
      "-p", config.googlePhotosPackage,
    ]);
    if (!launch.ok) return launch;

    let lastAction = "open Google Photos";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(attempt === 0 ? 1_500 : 750);
      const hierarchy = await command([
        "shell", "sh", "-c",
        "rm -f /sdcard/fairth-window.xml; uiautomator dump /sdcard/fairth-window.xml >/dev/null && cat /sdcard/fairth-window.xml",
      ], 15_000);
      if (!hierarchy.ok) {
        lastAction = "read the current Android screen";
        continue;
      }
      const decision = nextPhotosUiDecision(parseUiNodes(hierarchy.stdout));
      if (decision.kind === "complete") {
        await writeFile(photosReadyPath, `${new Date().toISOString()}\n`, { encoding: "utf8", mode: 0o600 });
        return { ok: true, stdout: "Google Photos backup is enabled.", stderr: "" };
      }
      if (decision.kind === "tap") {
        lastAction = decision.description;
        const tapped = await command(["shell", "input", "tap", String(decision.x), String(decision.y)]);
        if (!tapped.ok) return tapped;
      }
    }
    return {
      ok: false,
      message: `Fairth could not finish Google Photos setup while trying to ${lastAction}. Photos remains open in the Android viewer; complete the visible prompt, then retry.`,
      stdout: "",
      stderr: "",
    };
  }

  async function importMedia(localPath: string, remoteFilename: string, capturedAtMs: number, expectedSha256: string): Promise<CommandResult> {
    const directory = config.androidMediaDirectory;
    const partial = `${directory}/.${remoteFilename}.partial`;
    const destination = `${directory}/${remoteFilename}`;
    const createDirectory = await command(["shell", "mkdir", "-p", directory]);
    if (!createDirectory.ok) return createDirectory;
    const destinationDigest = await command(["shell", destinationDigestScript(destination)]);
    if (!destinationDigest.ok) return destinationDigest;
    if (destinationDigest.stdout === "missing") {
      const push = await command(["push", localPath, partial], 30 * 60_000);
      if (!push.ok) return push;
      const move = await command(["shell", `mv ${shellQuote(partial)} ${shellQuote(destination)}`]);
      if (!move.ok) return move;
    } else if (!destinationDigestMatches(destinationDigest.stdout, expectedSha256)) {
      return {
        ok: false,
        message: `Android already contains ${remoteFilename} with different content. Fairth left both files unchanged; remove or rename the Android copy before retrying.`,
        stdout: destinationDigest.stdout,
        stderr: destinationDigest.stderr,
      };
    }
    const restoreTime = await command(["shell", capturedAtTouchScript(destination, capturedAtMs)]);
    if (!restoreTime.ok) return restoreTime;
    const scan = await command([
      "shell", "am", "broadcast",
      "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
      "-d", `file://${destination}`,
    ]);
    if (!scan.ok) return scan;
    const verify = await command([
      "shell", "content", "query",
      "--uri", "content://media/external/file",
      "--projection", "_id:_display_name",
      "--where", `_display_name=\\'${basename(remoteFilename)}\\'`,
    ]);
    if (!verify.ok || !verify.stdout.includes(remoteFilename)) {
      return { ok: false, message: `MediaStore did not expose ${remoteFilename} after scanning. The Android copy remains at ${destination}; retry after Android finishes indexing.`, stdout: verify.stdout, stderr: verify.stderr };
    }
    return verify;
  }

  return { health, onboarding, onboardingAction, configurePhotos, googlePhotosProgress, importMedia, command };
}
