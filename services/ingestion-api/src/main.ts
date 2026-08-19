import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createUploadStorage } from "./storage.js";

const config = loadConfig();
const storage = createUploadStorage(config);
await storage.initialize();

const app = createApp(config, storage);
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: config.maxUploadBytes,
  fetch: app.fetch,
});
console.log(JSON.stringify({ level: "info", event: "listening", host: server.hostname, port: server.port }));

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  await server.stop();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
