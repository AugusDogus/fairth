import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { Hono } from "hono";
import type { Config } from "./config.js";
import { parseSessionRequest, safeFilename, type UploadMetadata } from "./domain.js";
import { StorageError, type UploadStorage } from "./storage.js";

const jsonBodyLimit = 64 * 1024;

function authorized(header: string | undefined, token: string): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > jsonBodyLimit) {
    throw new StorageError("invalid", "JSON request body exceeds 64 KiB.");
  }

  const body = request.body;
  if (body === null) throw new StorageError("invalid", "Request body is not valid JSON.");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > jsonBodyLimit) throw new StorageError("invalid", "JSON request body exceeds 64 KiB.");
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StorageError("invalid", "Request body is not valid JSON.");
  }
}

function contentLength(request: Request): number {
  const raw = request.headers.get("content-length");
  if (raw === null) throw new StorageError("invalid", "Content-Length is required for upload requests.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new StorageError("invalid", "Content-Length must be a non-negative integer.");
  return value;
}

function optionalHeader(request: Request, name: string, maximum: number): string | undefined {
  const value = request.headers.get(name);
  return value !== null && value.length > 0 && value.length <= maximum ? value : undefined;
}

function metadataFromHeaders(request: Request): UploadMetadata {
  const deviceId = optionalHeader(request, "x-device-id", 128);
  const album = optionalHeader(request, "x-album", 255);
  const capturedAt = optionalHeader(request, "x-captured-at", 64);
  return {
    ...(deviceId === undefined ? {} : { deviceId }),
    ...(album === undefined ? {} : { album }),
    ...(capturedAt === undefined ? {} : { capturedAt }),
  };
}

function uploadBody(request: Request): Readable {
  if (request.body === null) throw new StorageError("invalid", "Upload request body is required.");
  return Readable.fromWeb(request.body);
}

function uploadId(value: string): string {
  if (!/^[0-9a-f]+(?:-[0-9a-f]+)*$/.test(value)) {
    throw new StorageError("invalid", "Upload identifier must contain lowercase hexadecimal characters and hyphens only.");
  }
  return value;
}

function chunkIndex(value: string): number {
  if (!/^\d+$/.test(value)) throw new StorageError("invalid", "Chunk index must be a non-negative integer.");
  const index = Number(value);
  if (!Number.isSafeInteger(index)) throw new StorageError("invalid", "Chunk index exceeds the supported integer range.");
  return index;
}

export function createApp(config: Config, storage: UploadStorage) {
  const app = new Hono();

  app.use("*", async (context, next) => {
    await next();
    context.header("cache-control", "no-store");
    context.header("x-content-type-options", "nosniff");
  });

  app.get("/health", (context) => context.json({ status: "ok", service: "ingestion-api" }));

  app.use("*", async (context, next) => {
    if (!authorized(context.req.header("authorization"), config.token)) {
      return context.json({ error: "unauthorized", message: "Supply the configured ingestion token as a Bearer token." }, 401);
    }
    await next();
  });

  app.post("/upload", async (context) => {
    const filename = optionalHeader(context.req.raw, "x-file-name", 255);
    if (filename === undefined) throw new StorageError("invalid", "x-file-name is required and must not exceed 255 characters.");
    const request = context.req.raw;
    const result = await storage.acceptDirect(safeFilename(filename), metadataFromHeaders(request), uploadBody(request), contentLength(request));
    return context.json({ status: "ready", ...result }, 201);
  });

  app.post("/v1/uploads", async (context) => {
    const parsed = parseSessionRequest(await readJson(context.req.raw), config.maxUploadBytes);
    if (!parsed.ok) throw new StorageError("invalid", parsed.message);
    const session = await storage.createSession(parsed.value);
    return context.json({ uploadId: session.id, chunkSize: config.chunkBytes, receivedChunks: [] }, 201);
  });

  app.get("/v1/uploads/:id", async (context) => {
    const result = await storage.getSession(uploadId(context.req.param("id")));
    return context.json({
      uploadId: result.session.id,
      filename: result.session.filename,
      size: result.session.size,
      chunkSize: config.chunkBytes,
      receivedChunks: result.receivedChunks,
    });
  });

  app.put("/v1/uploads/:id/chunks/:chunk", async (context) => {
    const chunk = chunkIndex(context.req.param("chunk"));
    const request = context.req.raw;
    await storage.putChunk(uploadId(context.req.param("id")), chunk, uploadBody(request), contentLength(request));
    return context.json({ status: "accepted", chunk });
  });

  app.post("/v1/uploads/:id/complete", async (context) => {
    const result = await storage.completeSession(uploadId(context.req.param("id")));
    return context.json({ status: "ready", ...result }, 201);
  });

  app.notFound((context) => context.json({ error: "not_found", message: "No ingestion route matches this request." }, 404));

  app.onError((error, context) => {
    if (error instanceof StorageError) {
      switch (error.code) {
        case "not_found": return context.json({ error: error.code, message: error.message }, 404);
        case "conflict": return context.json({ error: error.code, message: error.message }, 409);
        case "invalid": return context.json({ error: error.code, message: error.message }, 400);
      }
    }
    console.error(JSON.stringify({ level: "error", event: "request_failed", message: error.message }));
    return context.json({ error: "internal", message: "The upload could not be processed. Existing completed media remains intact; retry the request." }, 500);
  });

  return app;
}
