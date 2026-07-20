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

// Render-loop seal: react-use-websocket's reconnect effect keys on the url
// argument (deps: [url, connect, ...]). An inline function/arrow url is a
// fresh reference every render → socket teardown + reopen each render → the
// open's flushSync setReadyState re-renders → React error #185 white page
// (see PR #561 / SocketBridge.tsx). The url MUST be a hoisted constant or a
// useMemo/useCallback-stable binding.
const RENDER_LOOP_SYNTAX = [
  {
    selector:
      "CallExpression[callee.name='useWebSocket'][arguments.0.type=/^(ArrowFunctionExpression|FunctionExpression)$/]",
    message:
      "Inline function url passed to useWebSocket creates a fresh reference every render, retriggering its reconnect effect in a flushSync loop (React #185). Hoist the url or wrap it in useMemo/useCallback keyed on stable deps.",
  },
]

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

// Client-only effect seal (adr-20260715-client-state-effect-architecture):
// raw WebSocket/fetch/storage/timers/DOM globals are banned in src/client so
// react-use-websocket / React Query / the typed ports+adapters own every
// primitive. Reuses the Bun-ban `no-restricted-globals` pattern already
// established for shared/client + server above. Escape valve is file-scoped
// (see the ignores list on the block below), not per-rule — *.adapter.ts is
// the only place these globals may appear directly.
const CLIENT_EFFECT_SEAL_GLOBALS = [
  { name: "WebSocket", message: "Raw WebSocket is banned in src/client — use react-use-websocket via SocketBridge/socketStore instead." },
  { name: "fetch", message: "Raw fetch is banned in src/client outside src/client/api/** — add a queryFn there and call it through React Query." },
  { name: "XMLHttpRequest", message: "Raw XMLHttpRequest is banned in src/client outside src/client/api/** — add a queryFn there and call it through React Query." },
  { name: "localStorage", message: "Raw localStorage is banned in src/client — reach it through storage.adapter.ts via StoragePort." },
  { name: "sessionStorage", message: "Raw sessionStorage is banned in src/client — reach it through storage.adapter.ts via StoragePort." },
  { name: "setTimeout", message: "Raw setTimeout is banned in src/client — reach it through timer.adapter.ts via TimerPort." },
  { name: "setInterval", message: "Raw setInterval is banned in src/client — reach it through timer.adapter.ts via TimerPort." },
  { name: "clearTimeout", message: "Raw clearTimeout is banned in src/client — reach it through timer.adapter.ts via TimerPort." },
  { name: "clearInterval", message: "Raw clearInterval is banned in src/client — reach it through timer.adapter.ts via TimerPort." },
  { name: "requestAnimationFrame", message: "Raw requestAnimationFrame is banned in src/client — reach it through timer.adapter.ts via TimerPort." },
  { name: "cancelAnimationFrame", message: "Raw cancelAnimationFrame is banned in src/client — reach it through timer.adapter.ts via TimerPort." },
  { name: "document", message: "Raw document is banned in src/client — reach it through dom.adapter.ts via DomPort." },
  { name: "window", message: "Raw window is banned in src/client — reach it through dom.adapter.ts via DomPort." },
  { name: "navigator", message: "Raw navigator is banned in src/client — reach it through dom.adapter.ts via DomPort (clipboard/sound have dedicated adapters)." },
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
      "no-restricted-syntax": ["error", ...TYPE_STRICT_SYNTAX, ...RENDER_LOOP_SYNTAX],

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
      "no-restricted-syntax": ["error", ...SHARED_CLIENT_SEAL_SYNTAX, ...TYPE_STRICT_SYNTAX, ...RENDER_LOOP_SYNTAX],
    },
  },
  {
    // Client effect seal (adr-20260715-client-state-effect-architecture,
    // PROGRESS.md chunk 5). Client-only: src/shared has no DOM/fetch/storage
    // surface to seal. `*.adapter.ts` is the sanctioned direct-primitive
    // site; tests/testing-helpers legitimately construct/stub these globals.
    files: ["src/client/**/*.{ts,tsx}"],
    ignores: [
      "src/client/**/*.adapter.ts",
      "src/client/**/*.test.ts",
      "src/client/**/*.test.tsx",
      "src/client/lib/testing/**",
      "src/client/adapters/testing/**",
      "src/client/api/**",
    ],
    rules: {
      "no-restricted-globals": ["error", ...CLIENT_EFFECT_SEAL_GLOBALS],
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
      "no-restricted-syntax": ["error", ...SHARED_CLIENT_SEAL_SYNTAX, AS_CAST_BAN, ...RENDER_LOOP_SYNTAX],
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
