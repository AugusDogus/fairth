import { spawn } from "node:child_process";
import { basename } from "node:path";
import type { Config } from "./config.js";

export type CommandResult =
  | Readonly<{ ok: true; stdout: string; stderr: string }>
  | Readonly<{ ok: false; message: string; stdout: string; stderr: string }>;

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

  async function importMedia(localPath: string, remoteFilename: string): Promise<CommandResult> {
    const directory = config.androidMediaDirectory;
    const partial = `${directory}/.${remoteFilename}.partial`;
    const destination = `${directory}/${remoteFilename}`;
    const createDirectory = await command(["shell", "mkdir", "-p", directory]);
    if (!createDirectory.ok) return createDirectory;
    const push = await command(["push", localPath, partial], 30 * 60_000);
    if (!push.ok) return push;
    const move = await command(["shell", "mv", partial, destination]);
    if (!move.ok) return move;
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

  return { health, importMedia, command };
}
