import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: [],
    exclude: [
      "**/node_modules/**",
      "worker/**",
      "client/cli/**",
      "client/openapi/**",
      ".next/**",
      "dist/**",
      "build/**",
      "coverage/**",
    ],
  },
});
