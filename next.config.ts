import type { NextConfig } from "next";

/**
 * A verification build writes to its own directory.
 *
 * `next build` and `next dev` both use `.next`. Running a build while the dev
 * server is up replaces chunk files the running server has already mapped, and
 * the next request fails with "Cannot find module './331.js'" — an alarming
 * error with nothing wrong in the code, fixed only by stopping everything and
 * clearing the cache. `npm run build:check` sets BUILD_CHECK and lands in
 * `.next-check` instead, so verifying a build never disturbs a live session.
 */
const isCheck = process.env.BUILD_CHECK === "1";

const config: NextConfig = {
  ...(isCheck ? { distDir: ".next-check" } : {}),
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default config;
