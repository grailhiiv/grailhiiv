import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["cloud.spec.ts", "n8n.spec.ts", "agents.spec.ts", "operations.spec.ts", "social.spec.ts", "settings.spec.ts"],
  workers: 1,
  use: {
    baseURL: process.env.GRAILHIIV_TEST_URL || "http://127.0.0.1:3100",
    headless: true,
    trace: "retain-on-failure",
  },
  reporter: "list",
});
