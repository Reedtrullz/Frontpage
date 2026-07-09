import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      "./*.md",
      "./.github/**/*",
      "./ansible-playbook.yml",
      "./CLAUDE.md",
      "./DEPLOYMENT.md",
      "./docs/**/*",
      "./Dockerfile",
      "./eslint.config.mjs",
      "./group_vars/**/*",
      "./inventory/**/*",
      "./ops/**/*",
      "./src/**/*.test.ts",
      "./src/**/AGENTS.md",
      "./tsconfig.json",
      "./vitest.config.ts",
    ],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
