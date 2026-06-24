import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $getRoot, $createParagraphNode } from "lexical"
import {
  MermaidNode,
  $createMermaidNode,
  $isMermaidNode,
  type SerializedMermaidNode,
} from "./MermaidNode"

function buildEditor() {
  return createHeadlessEditor({
    namespace: "test",
    nodes: [MermaidNode],
    onError: (e: Error) => {
      throw e
    },
  })
}

describe("MermaidNode", () => {
  it("getType() returns 'kanna-mermaid'", () => {
    expect(MermaidNode.getType()).toBe("kanna-mermaid")
  })

  it("isInline() returns false (block-level)", () => {
    const editor = buildEditor()
    let result = true
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const node = $createMermaidNode("graph LR\nA-->B")
        paragraph.append(node)
        root.append(paragraph)
        result = node.isInline()
      },
      { discrete: true },
    )
    expect(result).toBe(false)
  })

  it("getTextContent() returns the source string", async () => {
    const editor = buildEditor()
    let textContent = ""

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const node = $createMermaidNode("graph TD\nA --> B")
          paragraph.append(node)
          root.append(paragraph)
          textContent = node.getTextContent()
        },
        { discrete: true },
      )
      resolve()
    })

    expect(textContent).toBe("graph TD\nA --> B")
  })

  it("$isMermaidNode returns true for MermaidNode", async () => {
    const editor = buildEditor()
    let result = false

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const node = $createMermaidNode("pie\n title Example\n \"A\": 30")
          paragraph.append(node)
          root.append(paragraph)
          result = $isMermaidNode(node)
        },
        { discrete: true },
      )
      resolve()
    })

    expect(result).toBe(true)
  })

  it("$isMermaidNode returns false for non-MermaidNode", () => {
    expect($isMermaidNode(null)).toBe(false)
    expect($isMermaidNode(undefined)).toBe(false)
    expect($isMermaidNode("not a node")).toBe(false)
  })

  it("exportJSON / importJSON round-trip preserves source", async () => {
    const editor = buildEditor()
    let serialized: SerializedMermaidNode | null = null
    let roundTripped: SerializedMermaidNode | null = null

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const node = $createMermaidNode("sequenceDiagram\nAlice->>Bob: Hello!")
          paragraph.append(node)
          root.append(paragraph)
          serialized = node.exportJSON() as SerializedMermaidNode
          const restored = MermaidNode.importJSON(serialized)
          roundTripped = restored.exportJSON() as SerializedMermaidNode
        },
        { discrete: true },
      )
      resolve()
    })

    expect(serialized).not.toBeNull()
    expect(serialized!.type).toBe("kanna-mermaid")
    expect(serialized!.version).toBe(1)
    expect(serialized!.source).toBe("sequenceDiagram\nAlice->>Bob: Hello!")

    expect(roundTripped!.type).toBe(serialized!.type)
    expect(roundTripped!.source).toBe(serialized!.source)
    expect(roundTripped!.version).toBe(serialized!.version)
  })

  it("clone() preserves source", () => {
    const editor = buildEditor()
    let isInstance = false
    let textContent = ""
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const original = $createMermaidNode("graph LR\nX-->Y")
        paragraph.append(original)
        root.append(paragraph)
        const cloned = MermaidNode.clone(original)
        isInstance = cloned instanceof MermaidNode
        textContent = cloned.getTextContent()
      },
      { discrete: true },
    )
    expect(isInstance).toBe(true)
    expect(textContent).toBe("graph LR\nX-->Y")
  })
})
