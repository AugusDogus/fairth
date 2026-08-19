import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { isAPIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import type { Config } from "./config";

const secretFilename = "better-auth.secret";
const ownerSetupFilename = "owner-setup.token";
const companionClientId = "fairth-companion";

type OwnerSetupState =
  | Readonly<{ kind: "open"; token: string }>
  | Readonly<{ kind: "creating"; token: string }>
  | Readonly<{ kind: "closed" }>;

export type OwnerSetupResult =
  | Readonly<{ ok: true; headers: Headers }>
  | Readonly<{ ok: false; code: "closed" | "invalid_token" | "in_progress" | "invalid_owner"; message: string }>;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

async function readSecret(path: string): Promise<string | undefined> {
  try {
    const value = (await readFile(path, "utf8")).trim();
    return value.length >= 32 ? value : undefined;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function persistentSecret(path: string): Promise<string> {
  const existing = await readSecret(path);
  if (existing !== undefined) return existing;
  const generated = randomBytes(48).toString("base64url");
  try {
    await writeFile(path, `${generated}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return generated;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    const raced = await readSecret(path);
    if (raced === undefined) throw new Error(`Persistent secret at ${path} is invalid. Remove it and restart the service.`);
    return raced;
  }
}

function equalSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function createAuthService(config: Config) {
  await mkdir(config.authDataRoot, { recursive: true });
  const configuredSecret = process.env.BETTER_AUTH_SECRET?.trim();
  const secret = configuredSecret === undefined || configuredSecret.length === 0
    ? await persistentSecret(join(config.authDataRoot, secretFilename))
    : configuredSecret;
  if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters when explicitly configured.");

  const database = new Database(join(config.authDataRoot, "auth.sqlite"), { create: true });
  const auth = betterAuth({
    appName: "Fairth",
    baseURL: config.publicBaseUrl,
    database,
    secret,
    trustedOrigins: [config.publicBaseUrl],
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 12,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/device/code": { window: 60, max: 10 },
        "/device/token": { window: 60, max: 20 },
        "/sign-in/email": { window: 60, max: 10 },
      },
    },
    session: {
      expiresIn: 365 * 24 * 60 * 60,
      updateAge: 7 * 24 * 60 * 60,
    },
    advanced: {
      useSecureCookies: new URL(config.publicBaseUrl).protocol === "https:",
    },
    plugins: [
      deviceAuthorization({
        expiresIn: "30m",
        interval: "5s",
        userCodeLength: 8,
        verificationUri: `${config.publicBaseUrl}/device`,
        validateClient: (clientId) => clientId === companionClientId,
      }),
      bearer(),
    ],
  });

  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();

  const ownerRow = database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM user").get();
  const setupTokenPath = join(config.authDataRoot, ownerSetupFilename);
  let setupState: OwnerSetupState;
  if ((ownerRow?.count ?? 0) > 0) {
    setupState = { kind: "closed" };
    await rm(setupTokenPath, { force: true });
  } else {
    setupState = { kind: "open", token: await persistentSecret(setupTokenPath) };
  }

  function ownerSetupUrl(): string | undefined {
    if (setupState.kind === "closed") return undefined;
    const url = new URL("/setup", config.publicBaseUrl);
    url.searchParams.set("token", setupState.token);
    return url.toString();
  }

  async function createOwner(input: Readonly<{ token: string; name: string; email: string; password: string }>): Promise<OwnerSetupResult> {
    if (setupState.kind === "closed") return { ok: false, code: "closed", message: "The Fairth owner has already been created. Sign in instead." };
    if (!equalSecret(input.token, setupState.token)) return { ok: false, code: "invalid_token", message: "This owner setup link is invalid or expired." };
    if (setupState.kind === "creating") return { ok: false, code: "in_progress", message: "Owner setup is already in progress. Wait a moment and retry." };

    const token = setupState.token;
    setupState = { kind: "creating", token };
    try {
      const result = await auth.api.signUpEmail({
        body: {
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          password: input.password,
        },
        returnHeaders: true,
      });
      setupState = { kind: "closed" };
      await rm(setupTokenPath, { force: true });
      return { ok: true, headers: result.headers };
    } catch (error) {
      setupState = { kind: "open", token };
      if (isAPIError(error)) return { ok: false, code: "invalid_owner", message: error.message };
      throw error;
    }
  }

  return {
    auth,
    companionClientId,
    createOwner,
    ownerSetupUrl,
    close: () => database.close(),
  };
}

export type AuthService = Awaited<ReturnType<typeof createAuthService>>;
