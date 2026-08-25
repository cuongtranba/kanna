import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "../../..")
const clientRoot = join(repoRoot, "src/client")

async function clientSource() {
  const files = Array.from(new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: clientRoot, absolute: true }))
    .filter((file) => !file.includes(".test."))
  return (await Promise.all(files.map((file) => Bun.file(file).text()))).join("\n")
}

describe("UI source contract", () => {
  test("uses intentional motion properties and visible overflow affordances", async () => {
    const source = await clientSource()
    expect(source).not.toContain("transition-all")
    expect(source).not.toContain("scrollbar-hide")
    expect(source).not.toContain("scrollbar-width:none")
  })

  test("keeps operational labels on the documented type floor", async () => {
    const source = await clientSource()
    expect(source).not.toMatch(/\btext-(?:9|10|11)\b/)
    expect(source).not.toMatch(/\buppercase\b/)
  })

  test("does not bypass warm theme tokens in shared interaction surfaces", async () => {
    const sharedFiles = [
      "src/client/components/ui/button.tsx",
      "src/client/components/ui/dialog.tsx",
      "src/client/components/chat-ui/sidebar/StackChatCreateRow.tsx",
    ]
    const source = (await Promise.all(sharedFiles.map((file) => Bun.file(join(repoRoot, file)).text()))).join("\n")
    expect(source).not.toMatch(/\b(?:bg-black|text-white|dark:text-white)\b/)
  })
})
