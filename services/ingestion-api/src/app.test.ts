import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.js";
import { createAuthService } from "./auth.js";
import type { Config } from "./config.js";
import { createUploadStorage } from "./storage.js";

async function fixture() {
  const incomingRoot = await mkdtemp(join(tmpdir(), "fairth-app-"));
  const config: Config = {
    host: "127.0.0.1",
    port: 1,
    incomingRoot,
    authDataRoot: join(incomingRoot, "auth"),
    publicBaseUrl: "http://127.0.0.1:3000",
    maxUploadBytes: 100,
    chunkBytes: 4,
  };
  const storage = createUploadStorage(config);
  await storage.initialize();
  const authService = await createAuthService(config);
  const setupUrl = authService.ownerSetupUrl();
  if (setupUrl === undefined) throw new Error("Owner setup URL was not created.");
  const setupToken = new URL(setupUrl).searchParams.get("token");
  if (setupToken === null) throw new Error("Owner setup URL has no token.");
  const owner = await authService.createOwner({ token: setupToken, name: "Owner", email: "owner@example.com", password: "correct horse battery staple" });
  if (!owner.ok) throw new Error(owner.message);
  const ownerCookie = owner.headers.getSetCookie()[0]?.split(";", 1)[0];
  if (ownerCookie === undefined) throw new Error("Owner session cookie was not created.");

  const app = createApp(config, storage, authService);
  const codeResponse = await app.request("/api/auth/device/code", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Fairth Companion test" },
    body: JSON.stringify({ client_id: authService.companionClientId }),
  });
  const codeBody: unknown = await codeResponse.json();
  if (typeof codeBody !== "object" || codeBody === null || !("device_code" in codeBody) || typeof codeBody.device_code !== "string" || !("user_code" in codeBody) || typeof codeBody.user_code !== "string") {
    throw new Error("Device code response was invalid.");
  }
  const ownerHeaders = new Headers({ cookie: ownerCookie });
  await authService.auth.api.deviceVerify({ query: { user_code: codeBody.user_code }, headers: ownerHeaders });
  await authService.auth.api.deviceApprove({ body: { userCode: codeBody.user_code }, headers: ownerHeaders });
  const tokenResponse = await app.request("/api/auth/device/token", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Fairth Companion test" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: codeBody.device_code,
      client_id: authService.companionClientId,
    }),
  });
  const tokenBody: unknown = await tokenResponse.json();
  if (typeof tokenBody !== "object" || tokenBody === null || !("access_token" in tokenBody) || typeof tokenBody.access_token !== "string") {
    throw new Error("Device token response was invalid.");
  }
  const accessToken = tokenBody.access_token;
  return {
    incomingRoot,
    app,
    authorization: { authorization: `Bearer ${accessToken}` },
    revokeCompanion: async () => {
      await authService.auth.api.revokeSession({ body: { token: accessToken }, headers: ownerHeaders });
    },
    cleanup: async () => {
      authService.close();
      await rm(incomingRoot, { recursive: true, force: true });
    },
  };
}

describe("ingestion app", () => {
  test("exposes health without credentials and protects ingestion routes", async () => {
    const { app, cleanup } = await fixture();
    try {
      const health = await app.request("/health");
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", service: "ingestion-api" });
      expect(health.headers.get("cache-control")).toBe("no-store");

      const denied = await app.request("/v1/uploads", { method: "POST" });
      expect(denied.status).toBe(401);
      expect(await denied.json()).toEqual({ error: "unauthorized", message: "Supply a valid enrolled-device Bearer session." });

      const invalid = await app.request("/v1/uploads", { headers: { authorization: "Bearer definitely-wrong" } });
      expect(invalid.status).toBe(401);

      const externalSignUp = await app.request("/api/auth/sign-up/email", { method: "POST" });
      expect(externalSignUp.status).toBe(404);
    } finally {
      await cleanup();
    }
  });

  test("rejects a companion immediately after its owner revokes the session", async () => {
    const { app, authorization, revokeCompanion, cleanup } = await fixture();
    try {
      expect((await app.request("/v1/uploads/not-found", { headers: authorization })).status).toBe(400);
      await revokeCompanion();
      expect((await app.request("/v1/uploads/not-found", { headers: authorization })).status).toBe(401);
    } finally {
      await cleanup();
    }
  });

  test("publishes a direct upload", async () => {
    const { incomingRoot, app, authorization, cleanup } = await fixture();
    try {
      const body = "hello world";
      const response = await app.request("/upload", {
        method: "POST",
        headers: {
          ...authorization,
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
      await cleanup();
    }
  });

  test("supports resumable upload routes", async () => {
    const { app, authorization, cleanup } = await fixture();
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
      await cleanup();
    }
  });

  test("rejects malformed upload identifiers before storage access", async () => {
    const { app, authorization, cleanup } = await fixture();
    try {
      const response = await app.request("/v1/uploads/bad.id", { headers: authorization });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid",
        message: "Upload identifier must contain lowercase hexadecimal characters and hyphens only.",
      });
    } finally {
      await cleanup();
    }
  });
});
