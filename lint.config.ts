import { type OxlintConfig } from "oxlint"

// Oxlint port of the former eslint.config.js (adr-20261027-adopt-vite-plus-vitest-under-bun).
// Pure data: vite.config.ts hands it to `vp lint` / `vp check`, src/ops/architecture reads the
// complexity ceilings from it, and scripts/check-complexity-limits.ts derives its probe from it.
//
// Rule names: bare = native Oxlint core rule, `typescript/` and `react-hooks/` = native plugins,
// `eslint-js/` = the real ESLint rule through oxlint-plugin-eslint. `eslint-js/no-restricted-syntax`
// is the only way to keep the AST-selector gates. The ceilings and three further rules run as
// `eslint-js/` because the native versions diverge from ESLint on this tree: no-useless-return
// flags a `return` that stops a switch case falling through, no-unsafe-optional-chaining and
// prefer-object-spread unwrap `as`/`satisfies` where ESLint does not, and the native
// max-nested-callbacks counts differently, which would move the pinned ceiling.
//
// An override replaces a rule's options wholesale (as a later ESLint flat-config block did), so
// each override restates the full effective selector list for the files it covers.

type SyntaxBan = { readonly selector: string; readonly message: string }

// Type strictness: ban `any`, both cast spellings, and every spelling of an untyped value.
// These count the CONCEPT, not one keyword: `unknown | null`, `unknown[]` and
// `Record<string, unknown>` were all legal under a selector that matched only a direct
// annotation, and `export type AnyValue = unknown` reached 458 sites while satisfying it.
const AS_CAST_BAN: SyntaxBan = {
  selector:
    "TSAsExpression:not([typeAnnotation.type='TSTypeReference'][typeAnnotation.typeName.name='const'])",
  message:
    "Type assertions (`x as T`) are banned. Use `satisfies`, a type guard (`isX(v): v is X`), or proper generics. `as const` is allowed.",
}
const ANGLE_CAST_BAN: SyntaxBan = {
  selector: "TSTypeAssertion",
  message:
    "Angle-bracket assertions (`<T>x`) are banned exactly as `x as T` is. Use a type guard, `satisfies`, or proper generics.",
}
const UNKNOWN_BAN: SyntaxBan = {
  selector: "TSUnknownKeyword",
  message:
    "`unknown` is banned in EVERY position — annotation, union member, generic argument, array element. Use JsonValue/JsonObject/JsonArray (src/shared/json.ts) for a JSON boundary, a type predicate for another boundary, or toError() for a caught value.",
}
const UNTYPED_ALIAS_BAN: SyntaxBan = {
  selector: "TSTypeReference > Identifier[name=/^(AnyValue|LoadedModule|HostBag)$/]",
  message:
    "`AnyValue` is deleted — it was an alias for `unknown` that existed only to evade the unknown ban, which is a rename of the defect rather than a removal. Use JsonValue (src/shared/json.ts). `LoadedModule`/`HostBag` are for dynamic module namespaces only, in the files listed in lint.config.ts.",
}
const TYPE_STRICT_SYNTAX: readonly SyntaxBan[] = [AS_CAST_BAN, ANGLE_CAST_BAN, UNKNOWN_BAN, UNTYPED_ALIAS_BAN]

// Files permitted to name a dynamically loaded host value. Adding one is the review moment
// `AnyValue` never had. Split by layer because the two compose different rule sets.
const SHARED_CLIENT_DYNAMIC_MODULE_FILES = [
  "src/client/plugins/evaluatePlugin.ts",
  "src/client/plugins/hostModuleRegistry.ts",
  "src/client/lib/useWebSocket.ts",
]
const SERVER_OPS_DYNAMIC_MODULE_FILES = [
  "src/server/mermaid-parse.adapter.ts",
  "src/server/plugins/plugin-child-entry.adapter.ts",
  "src/ops/architecture/cjs-interop-scan.adapter.ts",
]

const SHARED_CLIENT_SEAL_SYNTAX: readonly SyntaxBan[] = [
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

// Client effect seal (adr-20260715-client-state-effect-architecture): raw WebSocket, fetch,
// storage, timers and DOM globals are banned in src/client; `*.adapter.ts` is the sanctioned site.
// Known gap carried over from ESLint: this list REPLACES the Bun ban on non-exempt client files.
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

const TAILWIND_COLOR_PREFIX = "(bg|text|border|fill|stroke|ring|shadow|from|to|via|decoration|outline|caret|accent|divide)"
const RAW_HEX = "#([0-9a-fA-F]{6}([0-9a-fA-F]{2})?|000|fff)\\b"

const DESIGN_HEX_UTILITY: readonly SyntaxBan[] = [
  {
    selector: `Literal[value=/${TAILWIND_COLOR_PREFIX}-\\[#/]`,
    message:
      "Arbitrary hex Tailwind utility banned (DESIGN.md). Use a design token class (bg-background, text-foreground, text-destructive, bg-warning, …).",
  },
  {
    selector: `TemplateElement[value.raw=/${TAILWIND_COLOR_PREFIX}-\\[#/]`,
    message:
      "Arbitrary hex Tailwind utility banned (DESIGN.md). Use a design token class (bg-background, text-foreground, text-destructive, bg-warning, …).",
  },
]

const DESIGN_RAW_HEX: readonly SyntaxBan[] = [
  {
    selector: `Literal[value=/${RAW_HEX}/i]`,
    message:
      "Raw hex color banned (DESIGN.md Tint-Everything Rule). Use a CSS var / token (var(--background), var(--foreground)) or a Tailwind token class.",
  },
  {
    selector: `TemplateElement[value.raw=/${RAW_HEX}/i]`,
    message:
      "Raw hex color banned (DESIGN.md Tint-Everything Rule). Use a CSS var / token (var(--background), var(--foreground)) or a Tailwind token class.",
  },
]

const DESIGN_BACKDROP: readonly SyntaxBan[] = [
  {
    selector: "Literal[value=/backdrop-(blur|filter)/]",
    message:
      "Glassmorphism banned (DESIGN.md No-Glassmorphism Rule). Use a solid bg-background surface; no backdrop-blur/backdrop-filter.",
  },
  {
    selector: "TemplateElement[value.raw=/backdrop-(blur|filter)/]",
    message:
      "Glassmorphism banned (DESIGN.md No-Glassmorphism Rule). Use a solid bg-background surface; no backdrop-blur/backdrop-filter.",
  },
]

const DESIGN_TITLE: readonly SyntaxBan[] = [
  {
    selector:
      "JSXOpeningElement[name.name=/^[a-z]/][name.name!='iframe'] > JSXAttribute[name.name='title']",
    message:
      "Native `title` tooltip banned (DESIGN.md). Use the project Tooltip component (src/client/components/ui/tooltip.tsx) as the hover-explanation surface.",
  },
]

const DESIGN_GATE_SYNTAX: readonly SyntaxBan[] = [
  ...DESIGN_HEX_UTILITY,
  ...DESIGN_RAW_HEX,
  ...DESIGN_BACKDROP,
  ...DESIGN_TITLE,
]
const DESIGN_GATE_SYNTAX_NO_RAW_HEX: readonly SyntaxBan[] = [
  ...DESIGN_HEX_UTILITY,
  ...DESIGN_BACKDROP,
  ...DESIGN_TITLE,
]

// A `.catch` whose handler does nothing hides the outcome of a side effect and satisfies
// no-floating-promises, which is why the pending-state gate needs this beside it.
const SILENT_CATCH_MESSAGE =
  "A `.catch` that discards the error hides a failed side effect. Launch user actions with runPendingAction and render the failure; for background work use runDetached (src/client/lib/runDetached.ts), which logs it."
const SILENT_CATCH_BAN: readonly SyntaxBan[] = [
  {
    selector:
      "CallExpression[callee.property.name='catch'] > :matches(ArrowFunctionExpression, FunctionExpression)[body.type='BlockStatement'][body.body.length=0]",
    message: SILENT_CATCH_MESSAGE,
  },
  {
    selector:
      "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='Identifier'][body.name='undefined']",
    message: SILENT_CATCH_MESSAGE,
  },
  {
    selector: "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='Literal'][body.value=null]",
    message: SILENT_CATCH_MESSAGE,
  },
]

// tsgolint's no-floating-promises does not report `void promise` when it is an arrow function's
// expression body (`onClick={() => void save()}`, `forEach(() => void save())`), which
// typescript-eslint did, and that exact spelling is why the pending-state gate exists. Without
// type information this selector bans any non-literal `void` expression body instead.
const VOID_PROMISE_BAN: readonly SyntaxBan[] = [
  {
    selector: "ArrowFunctionExpression[body.type='UnaryExpression'][body.operator='void'][body.argument.type!='Literal']",
    message:
      "`() => void expr` discards a promise nobody settles. Launch user actions with runPendingAction and render the failure; for background work use runDetached (src/client/lib/runDetached.ts), which logs it.",
  },
]

const noRestrictedSyntax = (...groups: readonly (readonly SyntaxBan[])[]): ["error", ...SyntaxBan[]] => [
  "error",
  ...groups.flat(),
]

const FS_GROUP = ["fs", "fs/*", "node:fs", "node:fs/*", "chokidar"]
const DATABASE_GROUP = ["bun:sqlite", "better-sqlite3", "pg"]
const PROCESS_GROUP = [
  "child_process",
  "node:child_process",
  "node:http",
  "node:https",
  "http",
  "https",
  "node:net",
  "net",
  "node:tls",
  "tls",
]

const restrictedImports = (
  messages: { readonly fs: string; readonly database: string; readonly process: string },
  extraProcessGroup: readonly string[] = [],
): ["error", { patterns: { group: string[]; message: string }[] }] => [
  "error",
  {
    patterns: [
      { group: FS_GROUP, message: messages.fs },
      { group: DATABASE_GROUP, message: messages.database },
      { group: [...PROCESS_GROUP, ...extraProcessGroup, "ws"], message: messages.process },
    ],
  },
]

const SHARED_CLIENT_IMPORT_MESSAGES = {
  fs: "Side-effect IO not allowed in src/shared or src/client. Move the module into src/server/** or depend on an injected port instead.",
  database: "Database clients are server-only. Move the module into src/server/** or depend on an injected port instead.",
  process: "Process spawn / raw http is server-only. Move the module into src/server/** or depend on an injected port instead.",
}
const SERVER_IMPORT_MESSAGES = {
  fs: "Side-effect IO must move into an adapter file (src/server/**/*.adapter.ts) or be reached through an injected port.",
  database: "Database clients must move into an adapter file or be reached through an injected port.",
  process: "Process spawn / raw http must move into an adapter file or be reached through an injected port.",
}
const BEACON_IMPORT_MESSAGE = "Beacon IO must live in a src/beacon/**/*.adapter.ts file or be reached through an injected port."
const BEACON_IMPORT_MESSAGES = { fs: BEACON_IMPORT_MESSAGE, database: BEACON_IMPORT_MESSAGE, process: BEACON_IMPORT_MESSAGE }

const bunGlobalBan = (message: string): ["error", { name: string; message: string }] => [
  "error",
  { name: "Bun", message },
]

const PRODUCTION_TEST_EXCLUDES = [
  "src/**/*.test.ts",
  "src/**/*.test.tsx",
  "src/**/__fixtures__/**",
  "src/**/test-helpers/**",
  "src/client/adapters/testing/**",
  "src/client/lib/testing/**",
]

// Complexity ceilings sit at today's PRODUCTION maxima; LINT_LIMIT_PINS in
// src/ops/architecture/budget.ts pins them and they may only ever be lowered.
// `bun run lint:limits` proves each is still tight rather than slack.
export const COMPLEXITY_CEILINGS = {
  "eslint-js/complexity": 127,
  "eslint-js/max-params": 11,
  "eslint-js/max-depth": 7,
  "eslint-js/max-nested-callbacks": 4,
} as const

const CLIENT_TEST_EXCLUDES = [
  "src/client/**/*.test.ts",
  "src/client/**/*.test.tsx",
  "src/client/lib/testing/**",
  "src/client/adapters/testing/**",
]

const stylistic = "warn"
const strict = "error"

// scripts/**, vite.config.ts and this file carry no lint rules (the base rules are scoped to src
// below) but stay in the program so `vp check --no-lint` type-checks the whole tsconfig.
export const lintConfig: OxlintConfig = {
  plugins: ["typescript", "react"],
  categories: { correctness: "off" },
  jsPlugins: [{ name: "eslint-js", specifier: "oxlint-plugin-eslint" }],
  options: { typeAware: true, typeCheck: true },
  ignorePatterns: [
    "dist/**",
    "node_modules/**",
    ".worktrees/**",
    "e2e/**",
    "wiki/**",
    "apps/**",
    "rules/**",
    "rule-tests/**",
    "docs/**",
    "public/**",
    "bin/**",
    "assets/**",
    "src/server/__fixtures__/plugins/.tmp-*/**",
  ],
  overrides: [
    {
      files: ["src/**/*.{ts,tsx}"],
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

      "for-direction": strict,
      "no-async-promise-executor": strict,
      "no-case-declarations": strict,
      "no-compare-neg-zero": strict,
      "no-cond-assign": [strict, "except-parens"],
      "no-constant-binary-expression": strict,
      "no-constant-condition": [strict, { checkLoops: "allExceptWhileTrue" }],
      "no-debugger": strict,
      "no-delete-var": strict,
      "no-dupe-else-if": strict,
      "no-duplicate-case": strict,
      "no-empty": [strict, { allowEmptyCatch: true }],
      "no-empty-character-class": strict,
      "no-empty-pattern": strict,
      "no-empty-static-block": strict,
      "no-ex-assign": strict,
      "no-extra-boolean-cast": strict,
      "no-fallthrough": strict,
      "no-global-assign": strict,
      "no-invalid-regexp": strict,
      "no-irregular-whitespace": [strict, { skipStrings: true }],
      "no-loss-of-precision": strict,
      "no-misleading-character-class": strict,
      "no-nonoctal-decimal-escape": strict,
      "no-prototype-builtins": strict,
      "no-regex-spaces": strict,
      "no-self-assign": strict,
      "no-shadow-restricted-names": strict,
      "no-sparse-arrays": strict,
      "no-unassigned-vars": strict,
      "no-unexpected-multiline": strict,
      "no-unsafe-finally": strict,
      "eslint-js/no-unsafe-optional-chaining": strict,
      "no-unused-labels": strict,
      "no-unused-private-class-members": strict,
      "no-useless-assignment": strict,
      "no-useless-backreference": strict,
      "no-useless-catch": strict,
      "no-useless-escape": strict,
      "preserve-caught-error": strict,
      "require-yield": strict,
      "use-isnan": strict,
      "valid-typeof": strict,
      "no-var": strict,
      "prefer-rest-params": strict,
      "no-else-return": strict,
      "no-unneeded-ternary": strict,
      "no-lonely-if": strict,
      "no-useless-rename": strict,
      "no-useless-concat": strict,
      "eslint-js/prefer-object-spread": strict,
      radix: strict,
      yoda: strict,
      "prefer-spread": strict,
      "guard-for-in": strict,
      "no-throw-literal": strict,
      "default-case-last": strict,
      "prefer-promise-reject-errors": strict,
      eqeqeq: [strict, "smart"],
      "prefer-const": [strict, { ignoreReadBeforeAssign: true }],
      "dot-notation": strict,
      "prefer-template": strict,
      "prefer-arrow-callback": strict,
      "no-implicit-coercion": strict,
      "object-shorthand": strict,
      "eslint-js/no-useless-return": strict,
      "no-param-reassign": strict,
      "no-console": strict,
      "no-nested-ternary": strict,

      "typescript/ban-ts-comment": strict,
      "typescript/no-array-constructor": strict,
      "typescript/no-duplicate-enum-values": strict,
      "typescript/no-explicit-any": strict,
      "typescript/no-extra-non-null-assertion": strict,
      "typescript/no-misused-new": strict,
      "typescript/no-namespace": strict,
      "typescript/no-non-null-asserted-optional-chain": strict,
      "typescript/no-require-imports": strict,
      "typescript/no-this-alias": strict,
      "typescript/no-unnecessary-type-constraint": strict,
      "typescript/no-unsafe-declaration-merging": strict,
      "typescript/no-unsafe-function-type": strict,
      "typescript/no-unused-expressions": strict,
      "typescript/no-wrapper-object-types": strict,
      "typescript/prefer-as-const": strict,
      "typescript/prefer-namespace-keyword": strict,
      "typescript/triple-slash-reference": strict,
      "typescript/no-unused-vars": [stylistic, { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

      "eslint-js/no-restricted-syntax": noRestrictedSyntax(TYPE_STRICT_SYNTAX),
    },
    },
    {
      files: ["src/shared/**/*.{ts,tsx}", "src/client/**/*.{ts,tsx}"],
      rules: {
        "no-restricted-imports": restrictedImports(SHARED_CLIENT_IMPORT_MESSAGES),
        "no-restricted-globals": bunGlobalBan(
          "Bun globals (Bun.spawn, Bun.$, Bun.file) are server-only. Move the module into src/server/** or depend on an injected port instead.",
        ),
        "eslint-js/no-restricted-syntax": noRestrictedSyntax(
          SHARED_CLIENT_SEAL_SYNTAX,
          TYPE_STRICT_SYNTAX,
          DESIGN_GATE_SYNTAX,
          SILENT_CATCH_BAN,
          VOID_PROMISE_BAN,
        ),
      },
    },
    {
      files: ["src/client/components/chat-ui/TerminalPane.tsx"],
      rules: {
        "eslint-js/no-restricted-syntax": noRestrictedSyntax(
          SHARED_CLIENT_SEAL_SYNTAX,
          TYPE_STRICT_SYNTAX,
          DESIGN_GATE_SYNTAX_NO_RAW_HEX,
          SILENT_CATCH_BAN,
          VOID_PROMISE_BAN,
        ),
      },
    },
    {
      files: ["src/client/**/*.{ts,tsx}"],
      excludeFiles: [
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
    // Pending-state gate (adr-20260925-client-pending-action-state): a promise launched from the
    // client must be settled by someone. `void promise` does not settle it, so ignoreVoid is off.
    {
      files: ["src/client/**/*.{ts,tsx}"],
      excludeFiles: CLIENT_TEST_EXCLUDES,
      rules: {
        "typescript/no-floating-promises": [
          "error",
          {
            ignoreVoid: false,
            allowForKnownSafeCalls: [{ from: "package", name: "NavigateFunction", package: "react-router" }],
          },
        ],
        "typescript/no-misused-promises": [
          "error",
          {
            checksConditionals: false,
            checksSpreads: false,
            checksVoidReturn: {
              attributes: true,
              arguments: false,
              inheritedMethods: false,
              properties: true,
              returns: false,
              variables: false,
            },
          },
        ],
      },
    },
    {
      files: ["src/**/*.{ts,tsx}"],
      excludeFiles: PRODUCTION_TEST_EXCLUDES,
      rules: {
        "eslint-js/complexity": [strict, { max: COMPLEXITY_CEILINGS["eslint-js/complexity"] }],
        "eslint-js/max-params": [strict, { max: COMPLEXITY_CEILINGS["eslint-js/max-params"] }],
        "eslint-js/max-depth": [strict, { max: COMPLEXITY_CEILINGS["eslint-js/max-depth"] }],
        "eslint-js/max-nested-callbacks": [strict, { max: COMPLEXITY_CEILINGS["eslint-js/max-nested-callbacks"] }],
      },
    },
    // Known gap carried over from ESLint: the server seal has no AST selectors, only imports and Bun.
    {
      files: ["src/server/**/*.{ts,tsx}"],
      excludeFiles: [
        "src/server/**/*.test.ts",
        "src/server/**/*.test.tsx",
        "src/server/__fixtures__/**",
        "src/server/test-helpers/**",
        "src/server/adapters/**",
        "src/server/**/*.adapter.ts",
      ],
      rules: {
        "no-restricted-imports": restrictedImports(SERVER_IMPORT_MESSAGES),
        "no-restricted-globals": bunGlobalBan(
          "Bun globals (Bun.spawn, Bun.$, Bun.file, Bun.write, Bun.serve) must move into an adapter file or be reached through an injected port.",
        ),
      },
    },
    {
      files: ["src/beacon/**/*.{ts,tsx}"],
      excludeFiles: ["src/beacon/**/*.test.ts", "src/beacon/**/*.adapter.ts"],
      rules: {
        "no-restricted-imports": restrictedImports(BEACON_IMPORT_MESSAGES, ["node:crypto", "crypto"]),
        "no-restricted-globals": bunGlobalBan(BEACON_IMPORT_MESSAGE),
        "eslint-js/no-restricted-syntax": noRestrictedSyntax(SHARED_CLIENT_SEAL_SYNTAX, TYPE_STRICT_SYNTAX),
      },
    },
    // Sanctioned logger chokepoint, then the two sanctioned `unknown` chokepoints: errors.ts (a
    // thrown value, narrowed by toError()) and dynamic-module.ts (an import()/require() namespace).
    {
      files: ["src/shared/log.ts"],
      rules: { "no-console": "off" },
    },
    {
      files: ["src/shared/errors.ts", "src/shared/dynamic-module.ts"],
      rules: {
        "eslint-js/no-restricted-syntax": noRestrictedSyntax(SHARED_CLIENT_SEAL_SYNTAX, [AS_CAST_BAN, ANGLE_CAST_BAN]),
      },
    },
    {
      files: SHARED_CLIENT_DYNAMIC_MODULE_FILES,
      rules: {
        "eslint-js/no-restricted-syntax": noRestrictedSyntax(SHARED_CLIENT_SEAL_SYNTAX, [
          AS_CAST_BAN,
          ANGLE_CAST_BAN,
          UNKNOWN_BAN,
        ]),
      },
    },
    {
      files: SERVER_OPS_DYNAMIC_MODULE_FILES,
      rules: {
        "eslint-js/no-restricted-syntax": noRestrictedSyntax([AS_CAST_BAN, ANGLE_CAST_BAN, UNKNOWN_BAN]),
      },
    },
    // Tests legitimately use console, `any`, casts and `unknown`. react-hooks/globals is off here
    // because the native rule flags test harness components that reassign a captured variable.
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
        "typescript/no-explicit-any": "off",
        "eslint-js/no-restricted-syntax": "off",
        "react-hooks/globals": "off",
      },
    },
  ],
}
