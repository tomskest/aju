import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../openapi/openapi.yaml",
  output: {
    path: "src/generated",
    format: "prettier",
    lint: false,
  },
  plugins: [
    "@hey-api/client-fetch",
    {
      name: "@hey-api/typescript",
      enums: "typescript",
    },
    "@hey-api/sdk",
  ],
});
