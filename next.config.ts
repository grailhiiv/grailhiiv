import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  output: process.env.GRAILHIIV_STANDALONE === "true" ? "standalone" : undefined,
  distDir: process.env.GRAILHIIV_DIST_DIR || ".next",
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
};
export default config;
