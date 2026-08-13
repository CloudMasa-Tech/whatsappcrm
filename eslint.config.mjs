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
    "next-env.d.ts",
    // Vendored minified opus-recorder encoder worker (served statically).
    "public/opus/**",
    // The QR gateway is a separate deployable with its own package.json
    // and tsconfig, and no React in it. Linting it with the Next app's
    // config produces only false positives — chiefly rules-of-hooks
    // firing on `useSupabaseAuthState`, which is named after Baileys'
    // `useMultiFileAuthState` interface and is not a React hook.
    "gateway/**",
  ]),
]);

export default eslintConfig;
