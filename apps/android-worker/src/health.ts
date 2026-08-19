import { createServer, type ServerResponse } from "node:http";
import { androidRpcRouter, type AndroidController } from "@fairth/android-rpc";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import type { ReturnTypeAdb } from "./types.js";
import type { ImportDatabase } from "./database.js";
import type { ImporterState } from "./importer.js";

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

export function createHealthServer(port: number, adb: ReturnTypeAdb, database: ImportDatabase, state: ImporterState, android: AndroidController) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path.startsWith("/trpc/")) {
      await nodeHTTPRequestHandler({
        req: request,
        res: response,
        path: path.slice("/trpc/".length),
        router: androidRpcRouter,
        createContext: () => ({ android }),
        maxBodySize: 4096,
        onError: ({ error, path: procedure }) => {
          console.error(JSON.stringify({ level: "error", event: "android_rpc_failed", procedure, message: error.message }));
        },
      });
      return;
    }
    if (request.method !== "GET" || (path !== "/health" && path !== "/ready")) {
      response.writeHead(404).end();
      return;
    }
    const androidHealth = await adb.health();
    const ready = androidHealth.connected && androidHealth.booted && androidHealth.photosInstalled;
    writeJson(response, path === "/ready" && !ready ? 503 : 200, {
      status: path === "/health" ? "ok" : ready ? "ready" : "not_ready",
      ready,
      android: androidHealth,
      worker: state,
      imports: database.counts(),
    });
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(JSON.stringify({ level: "info", event: "health_listening", port }));
  });
  return server;
}
