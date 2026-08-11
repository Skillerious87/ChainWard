import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // `.next-*` covers the throwaway build directories used by
  // `npm run verify:offline`, which runs beside an open development server.
  globalIgnores([".next/**", ".next-*/**", "coverage/**", "src/generated/prisma/**"]),
]);
