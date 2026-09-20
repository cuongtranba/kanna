import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $getRoot } from "lexical"
import {
  $createMentionNode,
  $isMentionNode,
  MentionNode,
  type SerializedMentionNode,
} from "./MentionNode"

function buildEditor() {
  return createHeadlessEditor({
    namespace: "test",
    nodes: [MentionNode],
    onError: (e: Error) => {
      throw e
    },
  })
}

describe("MentionNode — agent", () => {
  it("getTextContent returns wire form @agent/<name>", () => {
    const editor = buildEditor()
    let textContent = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "agent",
          value: "my-agent",
          label: "My Agent",
        })
        para.append(node)
        root.append(para)
        textContent = node.getTextContent()
      },
      { discrete: true },
    )

    expect(textContent).toBe("@agent/my-agent")
  })

  it("$isMentionNode returns true for agent node", () => {
    const editor = buildEditor()
    let isMention = false

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "agent",
          value: "my-agent",
          label: "My Agent",
        })
        para.append(node)
        root.append(para)
        isMention = $isMentionNode(node)
      },
      { discrete: true },
    )

    expect(isMention).toBe(true)
  })

  it("exportJSON / importJSON round-trip for agent", () => {
    const editor = buildEditor()
    let serialized: SerializedMentionNode | null = null
    let roundTripped: SerializedMentionNode | null = null

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "agent",
          value: "builder",
          label: "@agent/builder",
        })
        para.append(node)
        root.append(para)
        serialized = node.exportJSON() as SerializedMentionNode
        const restored = MentionNode.importJSON(serialized)
        roundTripped = restored.exportJSON() as SerializedMentionNode
      },
      { discrete: true },
    )

    expect(serialized).not.toBeNull()
    expect(serialized!.type).toBe("kanna-mention")
    expect(serialized!.mentionKind).toBe("agent")
    expect(serialized!.value).toBe("builder")
    expect(serialized!.label).toBe("@agent/builder")
    expect(serialized!.version).toBe(1)

    expect(roundTripped!.mentionKind).toBe(serialized!.mentionKind)
    expect(roundTripped!.value).toBe(serialized!.value)
    expect(roundTripped!.label).toBe(serialized!.label)
  })
})

describe("MentionNode — path", () => {
  it("getTextContent returns wire form @<path>", () => {
    const editor = buildEditor()
    let textContent = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "path",
          value: "src/server/agent.ts",
          label: "agent.ts",
        })
        para.append(node)
        root.append(para)
        textContent = node.getTextContent()
      },
      { discrete: true },
    )

    expect(textContent).toBe("@src/server/agent.ts")
  })

  it("exportJSON / importJSON round-trip for path", () => {
    const editor = buildEditor()
    let serialized: SerializedMentionNode | null = null
    let roundTripped: SerializedMentionNode | null = null

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "path",
          value: "src/client/index.ts",
          label: "index.ts",
        })
        para.append(node)
        root.append(para)
        serialized = node.exportJSON() as SerializedMentionNode
        const restored = MentionNode.importJSON(serialized)
        roundTripped = restored.exportJSON() as SerializedMentionNode
      },
      { discrete: true },
    )

    expect(serialized!.mentionKind).toBe("path")
    expect(serialized!.value).toBe("src/client/index.ts")
    expect(roundTripped!.mentionKind).toBe(serialized!.mentionKind)
    expect(roundTripped!.value).toBe(serialized!.value)
  })

  it("getType returns kanna-mention", () => {
    expect(MentionNode.getType()).toBe("kanna-mention")
  })
})

describe("MentionNode — project", () => {
  it("getTextContent returns wire form @project/<slug>", () => {
    const editor = buildEditor()
    let textContent = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "project",
          value: "wiki",
          label: "project/wiki",
        })
        para.append(node)
        root.append(para)
        textContent = node.getTextContent()
      },
      { discrete: true },
    )

    expect(textContent).toBe("@project/wiki")
  })

  it("round-trips through JSON", () => {
    const editor = buildEditor()
    const restored: SerializedMentionNode[] = []

    editor.update(
      () => {
        const node = $createMentionNode({
          mentionKind: "project",
          value: "work-api",
          label: "project/work-api",
        })
        const json = node.exportJSON()
        restored.push(MentionNode.importJSON(json).exportJSON())
      },
      { discrete: true },
    )

    expect(restored[0]).toEqual({
      type: "kanna-mention",
      version: 1,
      mentionKind: "project",
      value: "work-api",
      label: "project/work-api",
    })
  })

  it("is recognised by $isMentionNode", () => {
    const editor = buildEditor()
    let recognised = false
    editor.update(
      () => {
        recognised = $isMentionNode(
          $createMentionNode({ mentionKind: "project", value: "wiki", label: "project/wiki" }),
        )
      },
      { discrete: true },
    )
    expect(recognised).toBe(true)
  })
})
