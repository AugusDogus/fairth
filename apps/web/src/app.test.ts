import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthService } from "./auth";
import type { Config } from "./config";
import { sameOrigin } from "./owner-http";
import { createUploadStorage } from "./storage";
import { createUploadApi } from "./upload-api";

async function fixture() {
  const incomingRoot = await mkdtemp(join(tmpdir(), "fairth-app-"));
  const config: Config = {
    host: "127.0.0.1",
    port: 1,
    incomingRoot,
    authDataRoot: join(incomingRoot, "auth"),
    androidWorkerUrl: "http://127.0.0.1:3001",
    androidViewerUrl: "http://localhost:6080/vnc.html?autoconnect=1&resize=scale",
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

  const codeResponse = await authService.auth.handler(new Request("http://127.0.0.1:3000/api/auth/device/code", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Fairth Companion/test" },
    body: JSON.stringify({ client_id: authService.companionClientId }),
  }));
  const codeBody: unknown = await codeResponse.json();
  if (typeof codeBody !== "object" || codeBody === null || !("device_code" in codeBody) || typeof codeBody.device_code !== "string" || !("user_code" in codeBody) || typeof codeBody.user_code !== "string") {
    throw new Error("Device code response was invalid.");
  }
  const ownerHeaders = new Headers({ cookie: ownerCookie });
  await authService.auth.api.deviceVerify({ query: { user_code: codeBody.user_code }, headers: ownerHeaders });
  await authService.auth.api.deviceApprove({ body: { userCode: codeBody.user_code }, headers: ownerHeaders });
  const tokenResponse = await authService.auth.handler(new Request("http://127.0.0.1:3000/api/auth/device/token", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Fairth Companion/test" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: codeBody.device_code,
      client_id: authService.companionClientId,
    }),
  }));
  const tokenBody: unknown = await tokenResponse.json();
  if (typeof tokenBody !== "object" || tokenBody === null || !("access_token" in tokenBody) || typeof tokenBody.access_token !== "string") {
    throw new Error("Device token response was invalid.");
  }
  const accessToken = tokenBody.access_token;
  return {
    incomingRoot,
    api: createUploadApi(config, storage, authService, async () => ({
      imports: { pending: 1, imported: 2, failed: 0, duplicate: 0 },
      googlePhotos: { state: "idle", detail: "Google Photos is idle." },
    })),
    authService,
    authorization: { authorization: `Bearer ${accessToken}` },
    config,
    ownerHeaders,
    revokeCompanion: async () => {
      await authService.auth.api.revokeSession({ body: { token: accessToken }, headers: ownerHeaders });
    },
    cleanup: async () => {
      authService.close();
      await rm(incomingRoot, { recursive: true, force: true });
    },
  };
}

describe("web boundaries", () => {
  test("creates a short-lived preapproved companion pairing", async () => {
    const { authService, config, ownerHeaders, cleanup } = await fixture();
    try {
      const pairing = await authService.createCompanionPairing(ownerHeaders);
      const pairingUri = new URL(pairing.pairingUri);
      expect(pairingUri.protocol).toBe("fairth:");
      expect(pairingUri.hostname).toBe("pair");
      expect(pairingUri.searchParams.get("endpoint")).toBe(config.publicBaseUrl);
      expect(pairing.expiresAt).toBeGreaterThan(Date.now());

      const deviceCode = pairingUri.searchParams.get("device_code");
      if (deviceCode === null) throw new Error("Pairing URI did not contain a device code.");
      const response = await authService.auth.handler(new Request(`${config.publicBaseUrl}/api/auth/device/token`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Fairth Companion QR test" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: authService.companionClientId,
        }),
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ token_type: "Bearer" });

      const reused = await authService.auth.handler(new Request(`${config.publicBaseUrl}/api/auth/device/token`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "Fairth Companion QR test" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: authService.companionClientId,
        }),
      }));
      expect(reused.status).toBe(400);
    } finally {
      await cleanup();
    }
  });

  test("reads active sessions without requiring a fresh owner session", async () => {
    const { authService, config, ownerHeaders, cleanup } = await fixture();
    try {
      const current = await authService.auth.api.getSession({ headers: ownerHeaders });
      if (current === null) throw new Error("Owner session was not created.");
      const database = new Database(join(config.authDataRoot, "auth.sqlite"));
      try {
        database.query("UPDATE session SET createdAt = ? WHERE token = ?").run(new Date(0).toISOString(), current.session.token);
      } finally {
        database.close();
      }

      await expect(authService.auth.api.listSessions({ headers: ownerHeaders })).rejects.toMatchObject({
        statusCode: 403,
        body: { code: "SESSION_NOT_FRESH" },
      });
      expect(authService.activeCompanionSessionTokens(current.user.id)).toHaveLength(1);
      expect(authService.activeSessions(current.user.id)).toContainEqual(expect.objectContaining({ token: current.session.token }));
    } finally {
      await cleanup();
    }
  });

  test("accepts same-origin requests through a trusted public proxy", async () => {
    const { config, cleanup } = await fixture();
    try {
      const proxiedConfig: Config = { ...config, publicBaseUrl: "https://fairth.example-tailnet.ts.net:3443" };
      expect(sameOrigin(new Request("http://127.0.0.1:3000/actions/login", { headers: { origin: "null" } }), config)).toBe(true);
      expect(sameOrigin(new Request("http://127.0.0.1:3000/actions/login", {
        headers: {
          host: "127.0.0.1:3000",
          origin: "null",
          "x-forwarded-host": "fairth.example-tailnet.ts.net:3443",
          "x-forwarded-proto": "https",
        },
      }), proxiedConfig)).toBe(true);
      expect(sameOrigin(new Request("http://127.0.0.1:3000/actions/login", {
        headers: {
          origin: "null",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https",
        },
      }), proxiedConfig)).toBe(false);
      expect(sameOrigin(new Request("http://127.0.0.1:3000/actions/login", { headers: { origin: "https://attacker.example" } }), config)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test("protects uploads and revokes companion access immediately", async () => {
    const { api, authorization, revokeCompanion, cleanup } = await fixture();
    try {
      const denied = await api.createSession(new Request("http://127.0.0.1:3000/v1/uploads", { method: "POST" }));
      expect(denied.status).toBe(401);
      expect(await denied.json()).toEqual({ error: "unauthorized", message: "Supply a valid enrolled-device Bearer session." });

      expect((await api.getSession(new Request("http://127.0.0.1:3000/v1/uploads/not-found", { headers: authorization }), "not-found")).status).toBe(400);
      await revokeCompanion();
      expect((await api.getSession(new Request("http://127.0.0.1:3000/v1/uploads/not-found", { headers: authorization }), "not-found")).status).toBe(401);
    } finally {
      await cleanup();
    }
  });

  test("reports authenticated pipeline progress without claiming Google Photos completion", async () => {
    const { api, authorization, cleanup } = await fixture();
    try {
      const denied = await api.status(new Request("http://127.0.0.1:3000/v1/status"));
      expect(denied.status).toBe(401);

      const response = await api.status(new Request("http://127.0.0.1:3000/v1/status", { headers: authorization }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        imports: { pending: 1, imported: 2, failed: 0, duplicate: 0 },
        googlePhotos: { state: "idle", detail: "Google Photos is idle." },
      });
    } finally {
      await cleanup();
    }
  });

  test("publishes a direct upload", async () => {
    const { incomingRoot, api, authorization, cleanup } = await fixture();
    try {
      const body = "hello world";
      const response = await api.direct(new Request("http://127.0.0.1:3000/upload", {
        method: "POST",
        headers: {
          ...authorization,
          "content-length": String(Buffer.byteLength(body)),
          "x-captured-at": "2020-01-02T03:04:05.678Z",
          "x-file-name": "hello world.jpg",
          "x-device-id": "pixel-8-pro",
        },
        body,
      }));
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ status: "ready", sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9" });

      const files = (await readdir(join(incomingRoot, "ready"))).sort();
      expect(files).toHaveLength(2);
      const media = files.find((name) => !name.endsWith(".upload.json"));
      expect(media).toBeDefined();
      if (media === undefined) throw new Error("Published media file was not found.");
      expect(await readFile(join(incomingRoot, "ready", media), "utf8")).toBe(body);
      expect(JSON.parse(await readFile(join(incomingRoot, "ready", `${media}.upload.json`), "utf8"))).toMatchObject({
        metadata: { capturedAt: "2020-01-02T03:04:05.678Z", deviceId: "pixel-8-pro" },
        sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      });
    } finally {
      await cleanup();
    }
  });

  test("supports resumable uploads", async () => {
    const { api, authorization, cleanup } = await fixture();
    try {
      const createBody = JSON.stringify({ filename: "resume.jpg", size: 5, metadata: {} });
      const created = await api.createSession(new Request("http://127.0.0.1:3000/v1/uploads", {
        method: "POST",
        headers: { ...authorization, "content-length": String(Buffer.byteLength(createBody)), "content-type": "application/json" },
        body: createBody,
      }));
      expect(created.status).toBe(201);
      const createdBody: unknown = await created.json();
      if (typeof createdBody !== "object" || createdBody === null || !("uploadId" in createdBody) || typeof createdBody.uploadId !== "string") {
        throw new Error("Create upload response did not contain an uploadId.");
      }

      for (const [index, body] of ["hell", "o"].entries()) {
        const response = await api.putChunk(new Request(`http://127.0.0.1:3000/v1/uploads/${createdBody.uploadId}/chunks/${index}`, {
          method: "PUT",
          headers: { ...authorization, "content-length": String(Buffer.byteLength(body)) },
          body,
        }), createdBody.uploadId, String(index));
        expect(response.status).toBe(200);
      }

      const completed = await api.completeSession(new Request(`http://127.0.0.1:3000/v1/uploads/${createdBody.uploadId}/complete`, { method: "POST", headers: authorization }), createdBody.uploadId);
      expect(completed.status).toBe(201);
    } finally {
      await cleanup();
    }
  });
});
