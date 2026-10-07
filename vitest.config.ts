import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The *.db.test.ts files share one database and truncate it.
    fileParallelism: false,
    env: { TZ: process.env.TZ ?? "America/Chicago" },
  },
});
