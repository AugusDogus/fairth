import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { Config } from "./config";
import { parseSessionRequest, safeFilename, type UploadMetadata, type UploadSession } from "./domain";

export type UploadStorage = ReturnType<typeof createUploadStorage>;

export class StorageError extends Error {
  constructor(readonly code: "not_found" | "conflict" | "invalid", message: string) {
    super(message);
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function readSession(path: string, maxBytes: number): Promise<UploadSession> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new StorageError("not_found", "Upload session does not exist or is no longer resumable.");
  }
  if (typeof value !== "object" || value === null) {
    throw new StorageError("invalid", "Upload session metadata is corrupt. Remove the session and upload the file again.");
  }
  const record = Object.fromEntries(Object.entries(value));
  const parsed = parseSessionRequest(record, maxBytes);
  if (!parsed.ok || typeof record.id !== "string" || typeof record.createdAt !== "string") {
    throw new StorageError("invalid", "Upload session metadata is corrupt. Remove the session and upload the file again.");
  }
  return { ...parsed.value, id: record.id, createdAt: record.createdAt };
}

export function createUploadStorage(config: Config) {
  const sessionsRoot = join(config.incomingRoot, ".uploads");
  const readyRoot = join(config.incomingRoot, "ready");

  async function initialize(): Promise<void> {
    await Promise.all([
      mkdir(sessionsRoot, { recursive: true }),
      mkdir(readyRoot, { recursive: true }),
      mkdir(join(config.incomingRoot, "drop"), { recursive: true }),
      mkdir(join(config.incomingRoot, "archive"), { recursive: true }),
    ]);
  }

  async function createSession(input: Omit<UploadSession, "id" | "createdAt">): Promise<UploadSession> {
    const session: UploadSession = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    const directory = join(sessionsRoot, session.id);
    await mkdir(join(directory, "chunks"), { recursive: true });
    await writeJsonAtomic(join(directory, "session.json"), session);
    return session;
  }

  async function getSession(id: string): Promise<{ session: UploadSession; receivedChunks: number[] }> {
    const session = await readSession(join(sessionsRoot, id, "session.json"), config.maxUploadBytes);
    const chunkCount = Math.ceil(session.size / config.chunkBytes);
    const checks = Array.from({ length: chunkCount }, async (_, index) => {
      try {
        const info = await stat(join(sessionsRoot, id, "chunks", String(index)));
        const expected = Math.min(config.chunkBytes, session.size - index * config.chunkBytes);
        return info.isFile() && info.size === expected ? index : undefined;
      } catch {
        return undefined;
      }
    });
    return { session, receivedChunks: (await Promise.all(checks)).filter((index): index is number => index !== undefined) };
  }

  async function putChunk(id: string, index: number, body: Readable, contentLength: number): Promise<void> {
    const { session } = await getSession(id);
    const chunkCount = Math.ceil(session.size / config.chunkBytes);
    if (!Number.isSafeInteger(index) || index < 0 || index >= chunkCount) {
      throw new StorageError("invalid", `Chunk index must be between 0 and ${chunkCount - 1}.`);
    }
    const expected = Math.min(config.chunkBytes, session.size - index * config.chunkBytes);
    if (contentLength !== expected) {
      throw new StorageError("invalid", `Chunk ${index} must contain ${expected} bytes; received ${contentLength}.`);
    }
    const destination = join(sessionsRoot, id, "chunks", String(index));
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await pipeline(body, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      const actual = (await stat(temporary)).size;
      if (actual !== expected) {
        throw new StorageError("invalid", `Chunk ${index} ended after ${actual} bytes; expected ${expected}.`);
      }
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async function publish(source: string, filename: string, metadata: UploadMetadata, expectedHash?: string): Promise<{ filename: string; sha256: string }> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(source)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    if (expectedHash !== undefined && sha256 !== expectedHash) {
      throw new StorageError("invalid", `Completed upload SHA-256 mismatch. Expected ${expectedHash}; received ${sha256}.`);
    }
    const storedFilename = `${Date.now()}-${randomUUID()}-${safeFilename(filename)}`;
    const mediaPath = join(readyRoot, storedFilename);
    await rename(source, mediaPath);
    await writeJsonAtomic(`${mediaPath}.upload.json`, { originalFilename: filename, sha256, metadata, uploadedAt: new Date().toISOString() });
    return { filename: storedFilename, sha256 };
  }

  async function completeSession(id: string): Promise<{ filename: string; sha256: string }> {
    const directory = join(sessionsRoot, id);
    const lockPath = join(directory, "complete.lock");
    let lock;
    try {
      lock = await open(lockPath, "wx");
    } catch {
      throw new StorageError("conflict", "This upload is already being completed. Retry the status request shortly.");
    }
    try {
      const { session, receivedChunks } = await getSession(id);
      const count = Math.ceil(session.size / config.chunkBytes);
      if (receivedChunks.length !== count) throw new StorageError("conflict", `Upload is incomplete. Received ${receivedChunks.length} of ${count} chunks.`);
      const assembled = join(directory, `${randomUUID()}.assembled.tmp`);
      try {
        const output = createWriteStream(assembled, { flags: "wx", mode: 0o600 });
        for (let index = 0; index < count; index += 1) {
          await pipeline(createReadStream(join(directory, "chunks", String(index))), output, { end: false });
        }
        output.end();
        await new Promise<void>((resolve, reject) => {
          output.once("finish", resolve);
          output.once("error", reject);
        });
        const result = await publish(assembled, session.filename, session.metadata, session.sha256);
        await lock.close();
        await rm(directory, { recursive: true, force: true });
        return result;
      } finally {
        await rm(assembled, { force: true }).catch(() => undefined);
      }
    } finally {
      await lock.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }

  async function acceptDirect(filename: string, metadata: UploadMetadata, body: Readable, contentLength: number): Promise<{ filename: string; sha256: string }> {
    if (contentLength <= 0 || contentLength > config.maxUploadBytes) throw new StorageError("invalid", `Content-Length must be between 1 and ${config.maxUploadBytes}.`);
    const temporary = join(sessionsRoot, `${randomUUID()}.direct.tmp`);
    await mkdir(dirname(temporary), { recursive: true });
    try {
      await pipeline(body, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      const actual = (await stat(temporary)).size;
      if (actual !== contentLength) {
        throw new StorageError("invalid", `Upload ended after ${actual} bytes; Content-Length declared ${contentLength}.`);
      }
      return await publish(temporary, filename, metadata);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  return { initialize, createSession, getSession, putChunk, completeSession, acceptDirect };
}
