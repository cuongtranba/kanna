/**
 * Sanctioned `unknown` chokepoint #2: a dynamically loaded module namespace.
 *
 * `await import(<computed specifier>)` and `require(<computed name>)` produce a
 * value the compiler cannot describe — and unlike a JSON boundary it may hold
 * functions, class instances and getters, so `JsonValue` (src/shared/json.ts)
 * is not merely imprecise there but wrong. `mermaid`'s namespace is checked for
 * callable `initialize`/`parse`; a plugin bundle for a callable `default`;
 * `eslint.config.js` for an array of rule blocks. None of those are JSON.
 *
 * ## Why this is not `AnyValue` under a new name
 *
 * `AnyValue` was a general-purpose alias for `unknown`, importable from
 * anywhere, and it reached 458 sites across 120 files — a rename of the defect
 * rather than a removal of it. `LoadedModule` is banned by the same
 * `no-restricted-syntax` rule that bans `AnyValue`, and exempted only for the
 * short, enumerated file list in `eslint.config.js`. Spreading it therefore
 * costs a visible diff to the lint config naming each new file, which is
 * exactly the review moment that `AnyValue` never had.
 *
 * Narrow one of these with `isRecord` from `errors.ts`, then check the members
 * you actually need:
 *
 * ```ts
 * const loaded: LoadedModule = await import(url)
 * if (!isRecord(loaded) || typeof loaded.default !== "function") throw new Error(…)
 * ```
 *
 * This module is deliberately nothing but a type. Its file identity IS the
 * mechanism — the lint boundary needs somewhere to point at.
 */

export type LoadedModule = unknown

/**
 * A host object addressed by string key — `globalThis`, or a module-name → module
 * map. Its slots hold the same untyped host values `LoadedModule` describes, so
 * the two live together rather than each file redeclaring
 * `Record<string, unknown>` for itself (`mermaid-parse.adapter.ts`'s DOM shim and
 * `hostModuleRegistry.ts`'s module table had one apiece).
 */
export type HostBag = Record<string, LoadedModule>
