import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { Config } from "./config.js";
import { parseSessionRequest, safeFilename, type UploadMetadata } from "./domain.js";
import { StorageError, type UploadStorage } from "./storage.js";

type JsonRecord = Readonly<Record<string, unknown>>;

function sendJson(response: ServerResponse, status: number, value: JsonRecord): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function authorized(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers.authorization;
  if (supplied === undefined || !supplied.startsWith("Bearer ")) return false;
  const actual = Buffer.from(supplied.slice(7));
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new StorageError("invalid", "JSON request body exceeds 64 KiB.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StorageError("invalid", "Request body is not valid JSON.");
  }
}

function contentLength(request: IncomingMessage): number {
  const raw = request.headers["content-length"];
  if (raw === undefined) throw new StorageError("invalid", "Content-Length is required for upload requests.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new StorageError("invalid", "Content-Length must be a non-negative integer.");
  return value;
}

function optionalHeader(request: IncomingMessage, name: string, maximum: number): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : undefined;
}

function metadataFromHeaders(request: IncomingMessage): UploadMetadata {
  const deviceId = optionalHeader(request, "x-device-id", 128);
  const album = optionalHeader(request, "x-album", 255);
  const capturedAt = optionalHeader(request, "x-captured-at", 64);
  return {
    ...(deviceId === undefined ? {} : { deviceId }),
    ...(album === undefined ? {} : { album }),
    ...(capturedAt === undefined ? {} : { capturedAt }),
  };
}

function storageStatus(error: StorageError): number {
  switch (error.code) {
    case "not_found": return 404;
    case "conflict": return 409;
    case "invalid": return 400;
  }
}

export function createHttpServer(config: Config, storage: UploadStorage) {
  return createServer(async (request, response) => {
    response.setHeader("connection", "close");
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "ok", service: "ingestion-api" });
        return;
      }
      if (!authorized(request, config.token)) {
        sendJson(response, 401, { error: "unauthorized", message: "Supply the configured ingestion token as a Bearer token." });
        return;
      }

      if (request.method === "POST" && url.pathname === "/upload") {
        const filename = optionalHeader(request, "x-file-name", 255);
        if (filename === undefined) throw new StorageError("invalid", "x-file-name is required and must not exceed 255 characters.");
        const result = await storage.acceptDirect(safeFilename(filename), metadataFromHeaders(request), request, contentLength(request));
        sendJson(response, 201, { status: "ready", ...result });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/uploads") {
        const parsed = parseSessionRequest(await readJson(request), config.maxUploadBytes);
        if (!parsed.ok) throw new StorageError("invalid", parsed.message);
        const session = await storage.createSession(parsed.value);
        sendJson(response, 201, { uploadId: session.id, chunkSize: config.chunkBytes, receivedChunks: [] });
        return;
      }

      const match = /^\/v1\/uploads\/([0-9a-f-]+)(?:\/chunks\/(\d+)|\/complete)?$/.exec(url.pathname);
      if (match !== null) {
        const id = match[1];
        if (id === undefined) throw new StorageError("invalid", "Upload identifier is missing.");
        const chunk = match[2];
        if (request.method === "GET" && chunk === undefined && !url.pathname.endsWith("/complete")) {
          const result = await storage.getSession(id);
          sendJson(response, 200, {
            uploadId: result.session.id,
            filename: result.session.filename,
            size: result.session.size,
            chunkSize: config.chunkBytes,
            receivedChunks: result.receivedChunks,
          });
          return;
        }
        if (request.method === "PUT" && chunk !== undefined) {
          await storage.putChunk(id, Number(chunk), request, contentLength(request));
          sendJson(response, 200, { status: "accepted", chunk: Number(chunk) });
          return;
        }
        if (request.method === "POST" && url.pathname.endsWith("/complete")) {
          const result = await storage.completeSession(id);
          sendJson(response, 201, { status: "ready", ...result });
          return;
        }
      }

      sendJson(response, 404, { error: "not_found", message: "No ingestion route matches this request." });
    } catch (error) {
      if (error instanceof StorageError) {
        sendJson(response, storageStatus(error), { error: error.code, message: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown failure";
      console.error(JSON.stringify({ level: "error", event: "request_failed", message }));
      sendJson(response, 500, { error: "internal", message: "The upload could not be processed. Existing completed media remains intact; retry the request." });
    }
  });
}
