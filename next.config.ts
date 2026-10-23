import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Content-Security-Policy-Report-Only",
    value:
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; font-src 'self' data:",
  },
];

const nextConfig: NextConfig = {
  // The E2E server runs its own `next dev` beside the developer's server in the
  // same checkout; Next 16 takes a per-distDir dev lock, so the suite points
  // NEXT_DIST_DIR at .next-e2e/ rather than fighting over .next/.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  reactStrictMode: true,
  // Do not advertise the framework on a public, single-household deployment.
  poweredByHeader: false,
  // Next's dev badge floats over the bottom-left corner of the viewport, which
  // the 54px rail owns — it covers the account menu and swallows its clicks
  // while developing. The app shell is the full viewport, so turn it off.
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
