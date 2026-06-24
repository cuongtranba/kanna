import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $getRoot } from "lexical"
import {
  $createSlashCommandNode,
  $isSlashCommandNode,
  SlashCommandNode,
  type SerializedSlashCommandNode,
} from "./SlashCommandNode"

function buildEditor() {
  return createHeadlessEditor({
    namespace: "test",
    nodes: [SlashCommandNode],
    onError: (e: Error) => {
      throw e
    },
  })
}

describe("SlashCommandNode — no argument", () => {
  it("getTextContent returns /<name> without trailing space", () => {
    const editor = buildEditor()
    let textContent = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createSlashCommandNode({
          commandName: "clear",
          hasArgument: false,
        })
        para.append(node)
        root.append(para)
        textContent = node.getTextContent()
      },
      { discrete: true },
    )

    expect(textContent).toBe("/clear")
  })

  it("$isSlashCommandNode returns true", () => {
    const editor = buildEditor()
    let isCmd = false

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createSlashCommandNode({
          commandName: "help",
          hasArgument: false,
        })
        para.append(node)
        root.append(para)
        isCmd = $isSlashCommandNode(node)
      },
      { discrete: true },
    )

    expect(isCmd).toBe(true)
  })

  it("exportJSON / importJSON round-trip for no-argument command", () => {
    const editor = buildEditor()
    let serialized: SerializedSlashCommandNode | null = null
    let roundTripped: SerializedSlashCommandNode | null = null

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createSlashCommandNode({
          commandName: "exit",
          hasArgument: false,
        })
        para.append(node)
        root.append(para)
        serialized = node.exportJSON() as SerializedSlashCommandNode
        const restored = SlashCommandNode.importJSON(serialized)
        roundTripped = restored.exportJSON() as SerializedSlashCommandNode
      },
      { discrete: true },
    )

    expect(serialized).not.toBeNull()
    expect(serialized!.type).toBe("kanna-slash-command")
    expect(serialized!.commandName).toBe("exit")
    expect(serialized!.hasArgument).toBe(false)
    expect(serialized!.version).toBe(1)

    expect(roundTripped!.commandName).toBe(serialized!.commandName)
    expect(roundTripped!.hasArgument).toBe(serialized!.hasArgument)
  })
})

describe("SlashCommandNode — with argument", () => {
  it("getTextContent returns /<name> with trailing space", () => {
    const editor = buildEditor()
    let textContent = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createSlashCommandNode({
          commandName: "model",
          hasArgument: true,
        })
        para.append(node)
        root.append(para)
        textContent = node.getTextContent()
      },
      { discrete: true },
    )

    expect(textContent).toBe("/model ")
  })

  it("exportJSON / importJSON round-trip for argument command", () => {
    const editor = buildEditor()
    let serialized: SerializedSlashCommandNode | null = null
    let roundTripped: SerializedSlashCommandNode | null = null

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createSlashCommandNode({
          commandName: "model",
          hasArgument: true,
        })
        para.append(node)
        root.append(para)
        serialized = node.exportJSON() as SerializedSlashCommandNode
        const restored = SlashCommandNode.importJSON(serialized)
        roundTripped = restored.exportJSON() as SerializedSlashCommandNode
      },
      { discrete: true },
    )

    expect(serialized!.commandName).toBe("model")
    expect(serialized!.hasArgument).toBe(true)
    expect(roundTripped!.commandName).toBe(serialized!.commandName)
    expect(roundTripped!.hasArgument).toBe(serialized!.hasArgument)
  })

  it("getType returns kanna-slash-command", () => {
    expect(SlashCommandNode.getType()).toBe("kanna-slash-command")
  })
})
