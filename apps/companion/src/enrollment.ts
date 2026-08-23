import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";

const clientId = "fairth-companion";
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";

export type EnrollmentRedemption = Readonly<{
  baseUrl: string;
  deviceCode: string;
  expiresAt: number;
  intervalSeconds: number;
}>;

export type EnrollmentChallenge = EnrollmentRedemption & Readonly<{
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
}>;

export type PairingScanResult =
  | Readonly<{ ok: true; redemption: EnrollmentRedemption }>
  | Readonly<{ ok: false; message: string }>;

export type EnrollmentResult =
  | Readonly<{ ok: true; token: string }>
  | Readonly<{ ok: false; message: string }>;

function endpoint(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function client(baseUrl: string) {
  return createAuthClient({ baseURL: baseUrl, plugins: [deviceAuthorizationClient()] });
}

export function parsePairingScan(value: string, now = Date.now()): PairingScanResult {
  let pairingUri: URL;
  try {
    pairingUri = new URL(value);
  } catch {
    return { ok: false, message: "That is not a Fairth pairing QR code." };
  }
  if (pairingUri.protocol !== "fairth:" || pairingUri.hostname !== "pair" || pairingUri.searchParams.get("v") !== "1") {
    return { ok: false, message: "That is not a Fairth pairing QR code." };
  }

  const endpointValue = pairingUri.searchParams.get("endpoint");
  const deviceCode = pairingUri.searchParams.get("device_code");
  const expiresAt = Number(pairingUri.searchParams.get("expires_at"));
  const intervalSeconds = Number(pairingUri.searchParams.get("interval"));
  if (endpointValue === null || deviceCode === null) {
    return { ok: false, message: "This Fairth QR code is incomplete. Create a new code and scan it again." };
  }

  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpointValue);
  } catch {
    return { ok: false, message: "This Fairth QR code contains an invalid appliance address." };
  }
  const supportedProtocol = endpointUrl.protocol === "https:" || endpointUrl.protocol === "http:";
  if (
    !supportedProtocol
    || endpointUrl.username.length > 0
    || endpointUrl.password.length > 0
    || endpointUrl.search.length > 0
    || endpointUrl.hash.length > 0
  ) {
    return { ok: false, message: "This Fairth QR code contains an invalid appliance address." };
  }
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(deviceCode)) {
    return { ok: false, message: "This Fairth QR code contains an invalid device challenge." };
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    return { ok: false, message: "This Fairth QR code expired. Create a new code on the onboarding page." };
  }
  if (expiresAt > now + 31 * 60 * 1000) {
    return { ok: false, message: "This Fairth QR code has an invalid expiration time." };
  }
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 60) {
    return { ok: false, message: "This Fairth QR code contains an invalid polling interval." };
  }
  return {
    ok: true,
    redemption: {
      baseUrl: endpoint(endpointUrl.toString()),
      deviceCode,
      expiresAt,
      intervalSeconds,
    },
  };
}

export async function beginEnrollment(baseUrlValue: string): Promise<EnrollmentChallenge> {
  const baseUrl = endpoint(baseUrlValue);
  if (baseUrl.length === 0) throw new Error("Set an ingestion endpoint before enrolling this device.");
  const result = await client(baseUrl).device.code({ client_id: clientId, scope: "upload" });
  if (result.error !== null) throw new Error(result.error.error_description ?? "The ingestion API could not start device enrollment.");
  if (result.data === null) throw new Error("The ingestion API returned no device enrollment challenge.");
  return {
    baseUrl,
    deviceCode: result.data.device_code,
    userCode: result.data.user_code,
    verificationUri: result.data.verification_uri,
    verificationUriComplete: result.data.verification_uri_complete,
    expiresAt: Date.now() + result.data.expires_in * 1000,
    intervalSeconds: result.data.interval,
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function completeEnrollment(challenge: EnrollmentRedemption, deviceId: string): Promise<EnrollmentResult> {
  let intervalSeconds = Math.max(1, challenge.intervalSeconds);
  while (Date.now() < challenge.expiresAt) {
    await wait(intervalSeconds * 1000);
    const result = await client(challenge.baseUrl).device.token({
      grant_type: deviceGrant,
      device_code: challenge.deviceCode,
      client_id: clientId,
      fetchOptions: { headers: { "user-agent": `Fairth Companion/${deviceId}` } },
    });
    if (result.data?.access_token !== undefined) return { ok: true, token: result.data.access_token };
    const code = result.error?.error;
    if (code === "authorization_pending") continue;
    if (code === "slow_down") {
      intervalSeconds += 5;
      continue;
    }
    if (code === "access_denied") return { ok: false, message: "The Fairth owner denied this device." };
    if (code === "expired_token") return { ok: false, message: "The enrollment code expired. Start enrollment again." };
    return { ok: false, message: result.error?.error_description ?? "Device enrollment failed." };
  }
  return { ok: false, message: "The enrollment code expired. Start enrollment again." };
}
