import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $getRoot, $createParagraphNode } from "lexical"
import {
  LocalFileLinkNode,
  $createLocalFileLinkNode,
  $isLocalFileLinkNode,
  type SerializedLocalFileLinkNode,
} from "./LocalFileLinkNode"

function buildEditor() {
  return createHeadlessEditor({
    namespace: "test",
    nodes: [LocalFileLinkNode],
    onError: (e: Error) => {
      throw e
    },
  })
}

describe("LocalFileLinkNode", () => {
  it("getType() returns 'kanna-local-file-link'", () => {
    expect(LocalFileLinkNode.getType()).toBe("kanna-local-file-link")
  })

  it("isInline() returns true", () => {
    const editor = buildEditor()
    let result = false
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const node = $createLocalFileLinkNode({ path: "/tmp/foo.ts" })
        paragraph.append(node)
        root.append(paragraph)
        result = node.isInline()
      },
      { discrete: true },
    )
    expect(result).toBe(true)
  })

  it("getTextContent() returns the path", async () => {
    const editor = buildEditor()
    let textContent = ""

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const node = $createLocalFileLinkNode({ path: "/home/user/src/main.ts" })
          paragraph.append(node)
          root.append(paragraph)
          textContent = node.getTextContent()
        },
        { discrete: true },
      )
      resolve()
    })

    expect(textContent).toBe("/home/user/src/main.ts")
  })

  it("$isLocalFileLinkNode returns true for LocalFileLinkNode", async () => {
    const editor = buildEditor()
    let result = false

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const node = $createLocalFileLinkNode({ path: "/tmp/file.txt", line: 10 })
          paragraph.append(node)
          root.append(paragraph)
          result = $isLocalFileLinkNode(node)
        },
        { discrete: true },
      )
      resolve()
    })

    expect(result).toBe(true)
  })

  it("$isLocalFileLinkNode returns false for non-LocalFileLinkNode", () => {
    expect($isLocalFileLinkNode(null)).toBe(false)
    expect($isLocalFileLinkNode(undefined)).toBe(false)
    expect($isLocalFileLinkNode("not a node")).toBe(false)
  })

  it("exportJSON / importJSON round-trip: path only", async () => {
    const editor = buildEditor()
    let serialized: SerializedLocalFileLinkNode | null = null
    let roundTripped: SerializedLocalFileLinkNode | null = null

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const node = $createLocalFileLinkNode({ path: "/src/server/agent.ts" })
          paragraph.append(node)
          root.append(paragraph)
          serialized = node.exportJSON() as SerializedLocalFileLinkNode
          const restored = LocalFileLinkNode.importJSON(serialized)
          roundTripped = restored.exportJSON() as SerializedLocalFileLinkNode
        },
        { discrete: true },
      )
      resolve()
    })

    expect(serialized).not.toBeNull()
    expect(serialized!.type).toBe("kanna-local-file-link")
    expect(serialized!.version).toBe(1)
    expect(serialized!.path).toBe("/src/server/agent.ts")
    expect(serialized!.line).toBeUndefined()
    expect(serialized!.column).toBeUndefined()

    expect(roundTripped!.path).toBe(serialized!.path)
    expect(roundTripped!.line).toBeUndefined()
    expect(roundTripped!.column).toBeUndefined()
  })

  it("exportJSON / importJSON round-trip: path + line + column", async () => {
    const editor = buildEditor()
    let serialized: SerializedLocalFileLinkNode | null = null
    let roundTripped: SerializedLocalFileLinkNode | null = null

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const node = $createLocalFileLinkNode({
            path: "/src/client/app/App.tsx",
            line: 42,
            column: 7,
          })
          paragraph.append(node)
          root.append(paragraph)
          serialized = node.exportJSON() as SerializedLocalFileLinkNode
          const restored = LocalFileLinkNode.importJSON(serialized)
          roundTripped = restored.exportJSON() as SerializedLocalFileLinkNode
        },
        { discrete: true },
      )
      resolve()
    })

    expect(serialized!.path).toBe("/src/client/app/App.tsx")
    expect(serialized!.line).toBe(42)
    expect(serialized!.column).toBe(7)

    expect(roundTripped!.path).toBe(serialized!.path)
    expect(roundTripped!.line).toBe(serialized!.line)
    expect(roundTripped!.column).toBe(serialized!.column)
  })

  it("clone() preserves all fields", () => {
    const editor = buildEditor()
    let isInstance = false
    let textContent = ""
    let line: number | undefined
    let column: number | undefined
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const original = $createLocalFileLinkNode({ path: "/tmp/a.ts", line: 5, column: 12 })
        paragraph.append(original)
        root.append(paragraph)
        const cloned = LocalFileLinkNode.clone(original)
        isInstance = cloned instanceof LocalFileLinkNode
        textContent = cloned.getTextContent()
        line = cloned.exportJSON().line
        column = cloned.exportJSON().column
      },
      { discrete: true },
    )
    expect(isInstance).toBe(true)
    expect(textContent).toBe("/tmp/a.ts")
    expect(line).toBe(5)
    expect(column).toBe(12)
  })
})
