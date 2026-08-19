import type { NextConfig } from "next";

const ownerHeaders = [
  { key: "content-security-policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'" },
  { key: "referrer-policy", value: "no-referrer" },
  { key: "x-content-type-options", value: "nosniff" },
  { key: "x-frame-options", value: "DENY" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/owner/:path*", headers: ownerHeaders },
      { source: "/device", headers: ownerHeaders },
    ];
  },
};

export default nextConfig;
