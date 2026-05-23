import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"

const stylistic = ["warn"]
const strict = ["error"]

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".worktrees/**",
      "scripts/**",
      "**/*.config.js",
      "**/*.config.ts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": strict,
      "react-hooks/purity": strict,
      "react-hooks/globals": strict,
      "react-hooks/exhaustive-deps": stylistic,
      "react-hooks/set-state-in-effect": stylistic,
      "react-hooks/refs": stylistic,
      "react-hooks/immutability": stylistic,
      "react-hooks/preserve-manual-memoization": stylistic,
      "react-hooks/static-components": stylistic,

      "no-useless-assignment": strict,
      "preserve-caught-error": strict,
      "no-loss-of-precision": strict,
      "@typescript-eslint/no-this-alias": strict,

      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-async-promise-executor": "off",
      "no-prototype-builtins": "off",
      "no-misleading-character-class": "off",
      "prefer-const": "off",
      "no-cond-assign": "off",
      "no-fallthrough": "off",
      "no-case-declarations": "off",
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}", "src/client/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["fs", "fs/*", "node:fs", "node:fs/*", "chokidar"],
              message:
                "Side-effect IO not allowed in src/shared or src/client. Move the module into src/server/** or depend on an injected port instead.",
            },
            {
              group: ["bun:sqlite", "better-sqlite3", "pg"],
              message:
                "Database clients are server-only. Move the module into src/server/** or depend on an injected port instead.",
            },
            {
              group: ["child_process", "node:child_process", "node:http", "node:https", "http", "https"],
              message:
                "Process spawn / raw http is server-only. Move the module into src/server/** or depend on an injected port instead.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "Bun",
          message:
            "Bun globals (Bun.spawn, Bun.$, Bun.file) are server-only. Move the module into src/server/** or depend on an injected port instead.",
        },
      ],
    },
  },
)
