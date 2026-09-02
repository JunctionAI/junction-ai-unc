import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/* Unit/eval harness only. Playwright specs under tests/e2e are run by playwright,
   not vitest. The "@/" alias mirrors tsconfig paths (derive.ts + unc/context.ts use it). */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "tests/e2e/**", ".next/**"],
  },
});
