import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.js";
import type { Config } from "./config.js";
import { createUploadStorage } from "./storage.js";

const token = "0123456789abcdef0123456789abcdef";

async function fixture() {
  const incomingRoot = await mkdtemp(join(tmpdir(), "fairth-app-"));
  const config: Config = {
    host: "127.0.0.1",
    port: 1,
    incomingRoot,
    token,
    maxUploadBytes: 100,
    chunkBytes: 4,
  };
  const storage = createUploadStorage(config);
  await storage.initialize();
  return { incomingRoot, app: createApp(config, storage) };
}

describe("ingestion app", () => {
  test("exposes health without credentials and protects ingestion routes", async () => {
    const { incomingRoot, app } = await fixture();
    try {
      const health = await app.request("/health");
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", service: "ingestion-api" });
      expect(health.headers.get("cache-control")).toBe("no-store");

      const denied = await app.request("/v1/uploads", { method: "POST" });
      expect(denied.status).toBe(401);
      expect(await denied.json()).toEqual({ error: "unauthorized", message: "Supply the configured ingestion token as a Bearer token." });

      const invalid = await app.request("/v1/uploads", { headers: { authorization: "Bearer definitely-wrong" } });
      expect(invalid.status).toBe(401);
    } finally {
      await rm(incomingRoot, { recursive: true, force: true });
    }
  });

  test("publishes a direct upload", async () => {
    const { incomingRoot, app } = await fixture();
    try {
      const body = "hello world";
      const response = await app.request("/upload", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-length": String(Buffer.byteLength(body)),
          "x-file-name": "hello world.jpg",
          "x-device-id": "pixel-8-pro",
        },
        body,
      });
      expect(response.status).toBe(201);
      const result: unknown = await response.json();
      expect(result).toMatchObject({ status: "ready", sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9" });

      const files = (await readdir(join(incomingRoot, "ready"))).sort();
      expect(files).toHaveLength(2);
      const media = files.find((name) => !name.endsWith(".upload.json"));
      expect(media).toBeDefined();
      if (media === undefined) throw new Error("Published media file was not found.");
      expect(await readFile(join(incomingRoot, "ready", media), "utf8")).toBe(body);
    } finally {
      await rm(incomingRoot, { recursive: true, force: true });
    }
  });

  test("supports resumable upload routes", async () => {
    const { incomingRoot, app } = await fixture();
    const authorization = { authorization: `Bearer ${token}` };
    try {
      const createBody = JSON.stringify({ filename: "resume.jpg", size: 5, metadata: {} });
      const created = await app.request("/v1/uploads", {
        method: "POST",
        headers: { ...authorization, "content-length": String(Buffer.byteLength(createBody)), "content-type": "application/json" },
        body: createBody,
      });
      expect(created.status).toBe(201);
      const createdBody: unknown = await created.json();
      if (typeof createdBody !== "object" || createdBody === null || !("uploadId" in createdBody) || typeof createdBody.uploadId !== "string") {
        throw new Error("Create upload response did not contain an uploadId.");
      }

      for (const [index, body] of ["hell", "o"].entries()) {
        const response = await app.request(`/v1/uploads/${createdBody.uploadId}/chunks/${index}`, {
          method: "PUT",
          headers: { ...authorization, "content-length": String(Buffer.byteLength(body)) },
          body,
        });
        expect(response.status).toBe(200);
      }

      const completed = await app.request(`/v1/uploads/${createdBody.uploadId}/complete`, { method: "POST", headers: authorization });
      expect(completed.status).toBe(201);
    } finally {
      await rm(incomingRoot, { recursive: true, force: true });
    }
  });

  test("rejects malformed upload identifiers before storage access", async () => {
    const { incomingRoot, app } = await fixture();
    try {
      const response = await app.request("/v1/uploads/bad.id", { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid",
        message: "Upload identifier must contain lowercase hexadecimal characters and hyphens only.",
      });
    } finally {
      await rm(incomingRoot, { recursive: true, force: true });
    }
  });
});
