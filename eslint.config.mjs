import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "prisma/**/migrations/**",
      "workers/**",
      "apps/cli/**",
      "**/*.d.ts",
      "dist/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
      "*.tsbuildinfo",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // no-floating-promises requires type-aware linting (parserOptions.project).
      // Worth enabling later with a parallel type-checked config, but skipping
      // for now to keep `next lint` fast on CI.
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "react/react-in-jsx-scope": "off",
    },
  },
];

export default eslintConfig;
