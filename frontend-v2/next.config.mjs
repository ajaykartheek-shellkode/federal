/** @type {import('next').NextConfig} */
const BACKEND = process.env.BACKEND_ORIGIN || "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Same-origin /api/* → FastAPI backend, so AWS credentials never reach the browser.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND}/api/:path*` }];
  },
  experimental: {
    // Model-backed steps stream for several seconds; keep the dev/prod proxy open.
    proxyTimeout: 300_000,
  },
};

export default nextConfig;
