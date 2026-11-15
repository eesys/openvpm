const path = require("node:path");
const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");
const { loadEnvConfig, updateInitialEnv } = require(
  require.resolve("@next/env", {
    paths: [require.resolve("next/package.json")],
  }),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@openpims/db"],
};

module.exports = (phase) => {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    const repoRoot = path.resolve(__dirname, "../..");
    updateInitialEnv(process.env);
    loadEnvConfig(repoRoot, true, console, true);
    updateInitialEnv(process.env);

    if (!process.env.DATABASE_URL?.trim()) {
      throw new Error(
        `DATABASE_URL is missing. Create ${path.join(repoRoot, ".env")} from .env.example.`,
      );
    }
  }

  return nextConfig;
};
