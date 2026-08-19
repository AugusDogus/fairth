import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const ownerHeaders = [
  { key: "content-security-policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'" },
  { key: "referrer-policy", value: "no-referrer" },
  { key: "x-content-type-options", value: "nosniff" },
  { key: "x-frame-options", value: "DENY" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  transpilePackages: ["@fairth/android-rpc"],
  async headers() {
    return [
      { source: "/setup", headers: ownerHeaders },
      { source: "/login", headers: ownerHeaders },
      { source: "/onboarding", headers: ownerHeaders },
      { source: "/devices", headers: ownerHeaders },
      { source: "/device-approved", headers: ownerHeaders },
      { source: "/device", headers: ownerHeaders },
    ];
  },
};

export default nextConfig;
