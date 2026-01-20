import { defineConfig, globalIgnores } from "eslint/config"; // Importing the core ESLint config helpers
import nextVitals from "eslint-config-next/core-web-vitals"; // Importing the Next.js recommended rules
import nextTs from "eslint-config-next/typescript"; // Importing the TypeScript-specific linting rules

const eslintConfig = defineConfig([ // Merges the Next.js presets with the local ignore rules
  ...nextVitals,
  ...nextTs,
  // Overrides the default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig; // Export lint configuration
