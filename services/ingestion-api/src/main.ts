import { loadConfig } from "./config.js";
import { createHttpServer } from "./http.js";
import { createUploadStorage } from "./storage.js";

const config = loadConfig();
const storage = createUploadStorage(config);
await storage.initialize();

const server = createHttpServer(config, storage);
server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ level: "info", event: "listening", host: config.host, port: config.port }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  server.close((error) => {
    if (error !== undefined) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
