import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));

const isStaticExport = process.env.DWA_STATIC_EXPORT === "1";
const isStandaloneBuild = process.env.DWA_STANDALONE === "1";

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'microphone=(self), camera=(), geolocation=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isStaticExport ? { output: 'export' } : isStandaloneBuild ? { output: 'standalone' } : {}),
  allowedDevOrigins: ['127.0.0.1'],
  outputFileTracingRoot: __dirname,
  ...(!isStaticExport
    ? {
        async headers() {
          return [{ source: '/(.*)', headers: securityHeaders }]
        },
      }
    : {}),
  turbopack: {},
  webpack(config) {
    // OpenSSL 3.x (Node 18+) disables md4. Webpack's WASM fallback crashes
    // on Windows. Use sha256 instead — universally supported.
    config.output.hashFunction = 'sha256'
    const existingIgnored = config.watchOptions?.ignored
    const ignored = (Array.isArray(existingIgnored) ? existingIgnored : [existingIgnored])
      .filter((pattern) => typeof pattern === 'string' && pattern.length > 0)
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        ...ignored,
        '**/.playwright-mcp/**',
        '**/layout-*-after.png',
      ],
    }
    return config
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
