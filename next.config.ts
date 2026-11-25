import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Identifies this build to the service worker so each deploy replaces the previous deploy's saved assets.
const buildId = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? Date.now().toString(36))
  .replace(/[^a-zA-Z0-9]/g, "")
  .slice(0, 12);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  // The setup route reads migration SQL and the state boundaries from disk; serverless bundles only include
  // files that tracing can see, so name them.
  outputFileTracingIncludes: {
    "/api/cron/setup": ["./supabase/migrations/**/*", "./supabase/rollbacks/**/*", "./public/data/nigeria-states.geojson"],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/data/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
