import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"

const stylistic = ["warn"]
const strict = ["error"]

// Type-strictness: ban `any` (via @typescript-eslint/no-explicit-any), all
// `as` casts, and the `unknown` keyword. `as const` is explicitly exempted by
// the selector. `catch (e)` (no `unknown` keyword) is untouched.
const AS_CAST_BAN = {
  selector:
    "TSAsExpression:not([typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name='const'])",
  message:
    "Type assertions (`x as T`) are banned. Use `satisfies`, a type guard (`isX(v): v is X`), or proper generics. `as const` is allowed.",
}
const UNKNOWN_BAN = {
  selector: "TSTypeAnnotation > TSUnknownKeyword",
  message:
    "`unknown` is banned. Route boundary values through a typed guard, or narrow errors via src/shared/errors.ts `toError()`.",
}
const TYPE_STRICT_SYNTAX = [AS_CAST_BAN, UNKNOWN_BAN]

// Side-effect seal for shared/client (extracted so overrides can recompose it).
const SHARED_CLIENT_SEAL_SYNTAX = [
  {
    selector: "NewExpression[callee.name='Database']",
    message:
      "Direct SQLite/DB construction is server-only. Move into src/server/** or inject a port instead.",
  },
  {
    selector: "CallExpression[callee.object.name='process'][callee.property.name='exit']",
    message:
      "process.exit kills the runtime; not allowed in shared/client. Throw a typed error and let the entry point decide.",
  },
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message:
      "process.env reads at module load are not portable to the client bundle. Inject the value through a typed config object.",
  },
]

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

      // Strict correctness (already clean at adoption).
      "no-useless-assignment": strict,
      "preserve-caught-error": strict,
      "no-loss-of-precision": strict,
      "no-var": strict,
      "no-else-return": strict,
      "no-unneeded-ternary": strict,
      "no-lonely-if": strict,
      "no-useless-rename": strict,
      "no-useless-concat": strict,
      "prefer-object-spread": strict,
      radix: strict,
      yoda: strict,
      "prefer-spread": strict,
      "guard-for-in": strict,
      "no-throw-literal": strict,
      "default-case-last": strict,
      "prefer-promise-reject-errors": strict,
      "no-cond-assign": strict,
      "no-fallthrough": strict,
      "no-prototype-builtins": strict,
      "no-async-promise-executor": strict,
      "no-misleading-character-class": strict,

      // Strict quality (burn-down tier).
      eqeqeq: ["error", "smart"],
      // ignoreReadBeforeAssign: exempt the forward-reference init pattern
      // (a `let` read inside a closure created before its single assignment,
      // e.g. AgentCoordinator ↔ ScheduleManager circular wiring). Still flags
      // genuine never-reassigned lets.
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
      "dot-notation": strict,
      "prefer-template": strict,
      "prefer-arrow-callback": strict,
      "no-implicit-coercion": strict,
      "object-shorthand": strict,
      "no-useless-return": strict,
      "no-useless-escape": strict,
      "no-case-declarations": strict,
      "no-param-reassign": strict,
      "no-console": strict,
      "no-nested-ternary": strict,

      // Type strictness: ban any / as / unknown (as const allowed).
      "@typescript-eslint/no-this-alias": strict,
      "@typescript-eslint/no-explicit-any": strict,
      "no-restricted-syntax": ["error", ...TYPE_STRICT_SYNTAX],

      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Intentionally OFF: ANSI/terminal control-char regexes (tui-control.ts,
      // terminal-manager.ts, sandbox profiles, gfm markdown) legitimately embed
      // control chars; banning them is pure noise.
      "no-control-regex": "off",
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
      // Seal selectors + type-strictness (base's no-restricted-syntax is
      // replaced here, so the type-strict selectors must be re-included).
      "no-restricted-syntax": ["error", ...SHARED_CLIENT_SEAL_SYNTAX, ...TYPE_STRICT_SYNTAX],
    },
  },
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
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["fs", "fs/*", "node:fs", "node:fs/*", "chokidar"],
              message:
                "Side-effect IO must move into an adapter file (src/server/**/*.adapter.ts) or be reached through an injected port.",
            },
            {
              group: ["bun:sqlite", "better-sqlite3", "pg"],
              message:
                "Database clients must move into an adapter file or be reached through an injected port.",
            },
            {
              group: ["child_process", "node:child_process", "node:http", "node:https", "http", "https"],
              message:
                "Process spawn / raw http must move into an adapter file or be reached through an injected port.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "Bun",
          message:
            "Bun globals (Bun.spawn, Bun.$, Bun.file, Bun.write, Bun.serve) must move into an adapter file or be reached through an injected port.",
        },
      ],
    },
  },
  // Sanctioned logger chokepoint: the only file allowed to call console.
  {
    files: ["src/shared/log.ts"],
    rules: { "no-console": "off" },
  },
  // Sanctioned `unknown` chokepoint: toError(e: unknown) narrows boundary
  // errors. Keeps the as-ban + seal, drops only the unknown-keyword ban.
  {
    files: ["src/shared/errors.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...SHARED_CLIENT_SEAL_SYNTAX, AS_CAST_BAN],
    },
  },
  // Tests + fixtures + test-helpers legitimately use console, `any`, `as`
  // casts, and `unknown` (accessing private members, mock types, partial
  // stubs, and typed fixtures all require it).
  {
    files: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/test-helpers/**",
      "src/**/__fixtures__/**",
      "src/client/lib/testing/**",
    ],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-syntax": "off",
    },
  },
)
