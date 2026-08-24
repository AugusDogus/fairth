import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createAdb } from "./adb.js";
import { loadConfig } from "./config.js";
import { createAndroidController } from "./controller.js";
import { createImportDatabase } from "./database.js";
import { createHealthServer } from "./health.js";
import { createImporter, type ImporterState } from "./importer.js";

const config = loadConfig();
await mkdir(config.dataDirectory, { recursive: true });
await mkdir(`${config.dataDirectory}/home/.android`, { recursive: true });
for (const directory of ["ready", "drop", "archive"]) {
  await mkdir(`${config.incomingRoot}/${directory}`, { recursive: true });
}

const database = createImportDatabase(config.dataDirectory);
const adb = createAdb(config);
const android = createAndroidController(adb, database);
const state: ImporterState = { running: false };
const importer = createImporter(config, database, adb, state);
const healthServer = createHealthServer(config.healthPort, adb, database, state, android);

const provisioning = await android.reconcileProvisioning();
if (!provisioning.ok) console.error(JSON.stringify({ level: "error", event: "android_provisioning_incomplete", message: provisioning.message }));
await importer.cycle();
const interval = setInterval(() => void importer.cycle(), config.pollIntervalMs);
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  clearInterval(interval);
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  while (state.running) await delay(50);
  database.close();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
