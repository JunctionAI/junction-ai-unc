import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**", // standalone worker compiler output
    // Frozen prototype exports are visual source material, not production code.
    "design-reference/**",
    "launch-video/**", // independent Remotion project, checked by its own npm run lint
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
