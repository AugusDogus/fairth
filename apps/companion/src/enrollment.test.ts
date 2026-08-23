import { describe, expect, test } from "bun:test";
import { parsePairingScan } from "./enrollment";

const now = 1_800_000_000_000;
const deviceCode = "abcdefghijklmnopqrstuvwxyz0123456789ABCD";

function pairingUri(overrides: Readonly<Record<string, string>> = {}): string {
  const uri = new URL("fairth://pair");
  const values = {
    v: "1",
    endpoint: "https://fairth.example.ts.net:3443",
    device_code: deviceCode,
    expires_at: String(now + 30 * 60 * 1000),
    interval: "5",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) uri.searchParams.set(key, value);
  return uri.toString();
}

describe("companion QR pairing", () => {
  test("parses a valid short-lived challenge", () => {
    expect(parsePairingScan(pairingUri(), now)).toEqual({
      ok: true,
      redemption: {
        baseUrl: "https://fairth.example.ts.net:3443",
        deviceCode,
        expiresAt: now + 30 * 60 * 1000,
        intervalSeconds: 5,
      },
    });
  });

  test("rejects unrelated and expired QR codes", () => {
    expect(parsePairingScan("https://example.com", now)).toEqual({
      ok: false,
      message: "That is not a Fairth pairing QR code.",
    });
    expect(parsePairingScan(pairingUri({ expires_at: String(now - 1) }), now)).toEqual({
      ok: false,
      message: "This Fairth QR code expired. Create a new code on the onboarding page.",
    });
  });

  test("rejects appliance addresses containing credentials", () => {
    expect(parsePairingScan(pairingUri({ endpoint: "https://owner:secret@fairth.example.ts.net" }), now)).toEqual({
      ok: false,
      message: "This Fairth QR code contains an invalid appliance address.",
    });
  });
});
