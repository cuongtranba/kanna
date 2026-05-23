import baseConfig from "./eslint.config.js"

const RESTRICTED_IMPORT_PATTERNS = [
  {
    group: ["fs", "fs/*", "node:fs", "node:fs/*", "chokidar"],
    message:
      "Side-effect IO must move into an adapter file (src/server/**/*.adapter.ts) or be reached through an injected port. Tracked by .lintratchet.json — fix or refactor; do not add a disable comment.",
  },
  {
    group: ["bun:sqlite", "better-sqlite3", "pg"],
    message:
      "Database clients must move into an adapter file or be reached through an injected port. Tracked by .lintratchet.json — fix or refactor; do not add a disable comment.",
  },
  {
    group: ["child_process", "node:child_process", "node:http", "node:https", "http", "https"],
    message:
      "Process spawn / raw http must move into an adapter file or be reached through an injected port. Tracked by .lintratchet.json — fix or refactor; do not add a disable comment.",
  },
]

const RESTRICTED_GLOBALS = [
  {
    name: "Bun",
    message:
      "Bun globals (Bun.spawn, Bun.$, Bun.file, Bun.write, Bun.serve) must move into an adapter file or be reached through an injected port. Tracked by .lintratchet.json — fix or refactor; do not add a disable comment.",
  },
]

export default [
  ...baseConfig,
  {
    files: ["src/server/**/*.{ts,tsx}"],
    ignores: [
      "src/server/**/*.test.ts",
      "src/server/**/*.test.tsx",
      "src/server/__fixtures__/**",
      "src/server/test-helpers/**",
      "src/server/adapters/**",
      "src/server/**/*.adapter.ts",
    ],
    rules: {
      "no-restricted-imports": ["warn", { patterns: RESTRICTED_IMPORT_PATTERNS }],
      "no-restricted-globals": ["warn", ...RESTRICTED_GLOBALS],
    },
  },
]
