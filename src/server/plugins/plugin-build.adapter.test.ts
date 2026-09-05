import { describe, expect, test } from "bun:test"
import { join } from "node:path"

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
