import { createServer } from "node:http";
import type { ReturnTypeAdb } from "./types.js";
import type { ImportDatabase } from "./database.js";
import type { ImporterState } from "./importer.js";

export function createHealthServer(port: number, adb: ReturnTypeAdb, database: ImportDatabase, state: ImporterState) {
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" || (request.url !== "/health" && request.url !== "/ready")) {
      response.writeHead(404).end();
      return;
    }
    const android = await adb.health();
    const ready = android.connected && android.booted && android.photosInstalled;
    const body = JSON.stringify({
      status: request.url === "/health" ? "ok" : ready ? "ready" : "not_ready",
      ready,
      android,
      importer: state,
      imports: database.counts(),
    });
    response.writeHead(request.url === "/ready" && !ready ? 503 : 200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    response.end(body);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(JSON.stringify({ level: "info", event: "health_listening", port }));
  });
  return server;
}
