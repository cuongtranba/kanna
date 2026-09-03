import { describe, expect, test } from "bun:test"
import { join } from "node:path"

/**
 * Regression coverage for `HOST_STUB_NAMESPACE`'s onLoad handler. The P1
 * acceptance tests (`plugin-system-acceptance.test.tsx`) only assert on the
 * compiled bundle's TEXT, never evaluate it — which is exactly why the
 * bare-`{}` stub shipped unnoticed: it compiles fine and only throws once a
 * `.shared.ts`-style contract file calls a declarative builder from the
 * OTHER target's ABI (`defineRpc` from `@kanna/plugin/server`) at module top
 * level. This test evaluates the compiled output, not just its text.
 */
const TMP_DIR = join(import.meta.dir, "..", "__fixtures__", "plugins", ".tmp-shared-stub")

describe("plugin-build.adapter — HOST_STUB_NAMESPACE", () => {
  test("a top-level call to the other target's declarative builder compiles AND evaluates as an identity no-op", async () => {
    const { buildPluginBundles } = await import("./plugin-build.adapter")

    await Bun.write(
      join(TMP_DIR, "kanna-plugin.json"),
      JSON.stringify({ id: "stub-check", name: "Stub check", version: "1", kannaPluginApi: 1 }),
    )
    await Bun.write(
      join(TMP_DIR, "index.ts"),
      [
        'import { defineRpc } from "@kanna/plugin/server"',
        "",
        'export const contract = defineRpc({ name: "x" })',
        "",
        "export default function contribute() {",
        "  return () => {}",
        "}",
        "",
      ].join("\n"),
    )

    const result = await buildPluginBundles({ sourceDir: TMP_DIR, entry: "index.ts" })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // A bare `{}` stub answers `defineRpc(...)` with `undefined(...)`, which
    // throws before this import ever resolves. The fixed Proxy stub returns
    // its argument unchanged, so `contract` round-trips and `contribute`
    // stays reachable.
    const url = URL.createObjectURL(new Blob([result.client], { type: "text/javascript" }))
    try {
      const evaluated: Record<string, unknown> = await import(/* @vite-ignore */ url)
      expect(typeof evaluated.default).toBe("function")
      expect(evaluated.contract).toEqual({ name: "x" })
    } finally {
      URL.revokeObjectURL(url)
    }
  }, 60_000)
})
