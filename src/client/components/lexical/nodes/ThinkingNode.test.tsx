import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $getRoot, $createParagraphNode } from "lexical"
import {
  ThinkingNode,
  $createThinkingNode,
  $isThinkingNode,
  type SerializedThinkingNode,
} from "./ThinkingNode"

function buildEditor() {
  return createHeadlessEditor({
    namespace: "test",
    nodes: [ThinkingNode],
    onError: (e: Error) => {
      throw e
    },
  })
}

describe("ThinkingNode", () => {
  it("getType() returns 'kanna-thinking'", () => {
    expect(ThinkingNode.getType()).toBe("kanna-thinking")
  })

  it("isInline() returns false (block-level)", () => {
    const editor = buildEditor()
    let result = true
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const node = $createThinkingNode("Let me think about this...")
        paragraph.append(node)
        root.append(paragraph)
        result = node.isInline()
      },
      { discrete: true },
    )
    expect(result).toBe(false)
  })

  it("getTextContent() returns the content string", async () => {
    const editor = buildEditor()
    let textContent = ""

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const node = $createThinkingNode("I need to reason step by step.")
          paragraph.append(node)
          root.append(paragraph)
          textContent = node.getTextContent()
        },
        { discrete: true },
      )
      resolve()
    })

    expect(textContent).toBe("I need to reason step by step.")
  })

  it("$isThinkingNode returns true for ThinkingNode", async () => {
    const editor = buildEditor()
    let result = false

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const node = $createThinkingNode("Some internal reasoning here.")
          paragraph.append(node)
          root.append(paragraph)
          result = $isThinkingNode(node)
        },
        { discrete: true },
      )
      resolve()
    })

    expect(result).toBe(true)
  })

  it("$isThinkingNode returns false for non-ThinkingNode", () => {
    expect($isThinkingNode(null)).toBe(false)
    expect($isThinkingNode(undefined)).toBe(false)
    expect($isThinkingNode("not a node")).toBe(false)
  })

  it("exportJSON / importJSON round-trip preserves content", async () => {
    const editor = buildEditor()
    let serialized: SerializedThinkingNode | null = null
    let roundTripped: SerializedThinkingNode | null = null

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const node = $createThinkingNode(
            "First, let me break this down into smaller pieces.\n\nStep 1: analyze the problem.",
          )
          paragraph.append(node)
          root.append(paragraph)
          serialized = node.exportJSON() as SerializedThinkingNode
          const restored = ThinkingNode.importJSON(serialized)
          roundTripped = restored.exportJSON() as SerializedThinkingNode
        },
        { discrete: true },
      )
      resolve()
    })

    expect(serialized).not.toBeNull()
    expect(serialized!.type).toBe("kanna-thinking")
    expect(serialized!.version).toBe(1)
    expect(serialized!.content).toBe(
      "First, let me break this down into smaller pieces.\n\nStep 1: analyze the problem.",
    )

    expect(roundTripped!.type).toBe(serialized!.type)
    expect(roundTripped!.content).toBe(serialized!.content)
    expect(roundTripped!.version).toBe(serialized!.version)
  })

  it("clone() preserves content", () => {
    const editor = buildEditor()
    let isInstance = false
    let textContent = ""
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const original = $createThinkingNode("Think think think...")
        paragraph.append(original)
        root.append(paragraph)
        const cloned = ThinkingNode.clone(original)
        isInstance = cloned instanceof ThinkingNode
        textContent = cloned.getTextContent()
      },
      { discrete: true },
    )
    expect(isInstance).toBe(true)
    expect(textContent).toBe("Think think think...")
  })
})
