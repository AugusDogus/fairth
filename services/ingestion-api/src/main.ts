import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createAuthService } from "./auth.js";
import { createUploadStorage } from "./storage.js";

const config = loadConfig();
const storage = createUploadStorage(config);
await storage.initialize();
const authService = await createAuthService(config);

const app = createApp(config, storage, authService);
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: config.maxUploadBytes,
  fetch: app.fetch,
});
console.log(JSON.stringify({ level: "info", event: "listening", host: server.hostname, port: server.port }));
const ownerSetupUrl = authService.ownerSetupUrl();
if (ownerSetupUrl !== undefined) console.log(JSON.stringify({ level: "info", event: "owner_setup_required", url: ownerSetupUrl }));

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  await server.stop();
  authService.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
