import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `react-hooks/set-state-in-effect` (nouvelle règle React 19) est très
      // agressive : elle signale des patterns standard et légitimes du projet —
      // chargement de données dans useEffect (pages admin), init client-only
      // après hydratation (navigator.language, localStorage). Les vraies
      // anomalies (accès aux refs pendant le rendu) restent actives.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["scripts/generate-cahier-des-charges.js"],
    rules: {
      // Script Node autonome en CommonJS (package.json sans "type": "module")
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
