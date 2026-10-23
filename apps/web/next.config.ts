import { config } from "dotenv";
import type { NextConfig } from "next";
import { resolve } from "node:path";

config({ path: resolve(import.meta.dirname, "../../.env") });

const nextConfig: NextConfig = {
  transpilePackages: ["@openpims/db"],
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
