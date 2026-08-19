import { Readable } from "node:stream";
import type { AuthService } from "./auth";
import type { Config } from "./config";
import { parseSessionRequest, safeFilename, type UploadMetadata } from "./domain";
import { StorageError, type UploadStorage } from "./storage";

const jsonBodyLimit = 64 * 1024;
const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: responseHeaders });
}

async function readJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > jsonBodyLimit) {
    throw new StorageError("invalid", "JSON request body exceeds 64 KiB.");
  }

  if (request.body === null) throw new StorageError("invalid", "Request body is not valid JSON.");
  const reader = request.body.getReader();
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

async function* bodyChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function uploadBody(request: Request): Readable {
  if (request.body === null) throw new StorageError("invalid", "Upload request body is required.");
  return Readable.from(bodyChunks(request.body));
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

function errorResponse(error: unknown): Response {
  if (error instanceof StorageError) {
    switch (error.code) {
      case "not_found": return json({ error: error.code, message: error.message }, 404);
      case "conflict": return json({ error: error.code, message: error.message }, 409);
      case "invalid": return json({ error: error.code, message: error.message }, 400);
    }
  }
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(JSON.stringify({ level: "error", event: "upload_request_failed", message }));
  return json({ error: "internal", message: "The upload could not be processed. Existing completed media remains intact; retry the request." }, 500);
}

export function createUploadApi(config: Config, storage: UploadStorage, authService: AuthService) {
  async function run(request: Request, operation: () => Promise<Response>): Promise<Response> {
    const session = await authService.auth.api.getSession({ headers: request.headers });
    if (session === null) return json({ error: "unauthorized", message: "Supply a valid enrolled-device Bearer session." }, 401);
    try {
      return await operation();
    } catch (error) {
      return errorResponse(error);
    }
  }

  return {
    direct: (request: Request) => run(request, async () => {
      const filename = optionalHeader(request, "x-file-name", 255);
      if (filename === undefined) throw new StorageError("invalid", "x-file-name is required and must not exceed 255 characters.");
      const result = await storage.acceptDirect(safeFilename(filename), metadataFromHeaders(request), uploadBody(request), contentLength(request));
      return json({ status: "ready", ...result }, 201);
    }),
    createSession: (request: Request) => run(request, async () => {
      const parsed = parseSessionRequest(await readJson(request), config.maxUploadBytes);
      if (!parsed.ok) throw new StorageError("invalid", parsed.message);
      const session = await storage.createSession(parsed.value);
      return json({ uploadId: session.id, chunkSize: config.chunkBytes, receivedChunks: [] }, 201);
    }),
    getSession: (request: Request, id: string) => run(request, async () => {
      const result = await storage.getSession(uploadId(id));
      return json({
        uploadId: result.session.id,
        filename: result.session.filename,
        size: result.session.size,
        chunkSize: config.chunkBytes,
        receivedChunks: result.receivedChunks,
      });
    }),
    putChunk: (request: Request, id: string, rawChunk: string) => run(request, async () => {
      const chunk = chunkIndex(rawChunk);
      await storage.putChunk(uploadId(id), chunk, uploadBody(request), contentLength(request));
      return json({ status: "accepted", chunk });
    }),
    completeSession: (request: Request, id: string) => run(request, async () => {
      const result = await storage.completeSession(uploadId(id));
      return json({ status: "ready", ...result }, 201);
    }),
  };
}

export type UploadApi = ReturnType<typeof createUploadApi>;
