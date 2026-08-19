import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";

const clientId = "fairth-companion";
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";

export type EnrollmentChallenge = Readonly<{
  baseUrl: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: number;
  intervalSeconds: number;
}>;

export type EnrollmentResult =
  | Readonly<{ ok: true; token: string }>
  | Readonly<{ ok: false; message: string }>;

function endpoint(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function client(baseUrl: string) {
  return createAuthClient({ baseURL: baseUrl, plugins: [deviceAuthorizationClient()] });
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

export async function completeEnrollment(challenge: EnrollmentChallenge, deviceId: string): Promise<EnrollmentResult> {
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
