/**
 * Tests for MentionTypeaheadPlugin.
 *
 * Strategy: the plugin delegates rendering to LexicalTypeaheadMenuPlugin which
 * requires a real DOM and a running React+Lexical tree — wiring that up just
 * to test the plugin would be extremely brittle.  Instead we test the two
 * independently-testable pieces:
 *
 *   1. MentionMenuOption — key derivation, data storage.
 *   2. Node-insertion logic — use a headless editor to verify that
 *      $createMentionNode produces the correct wire-form text content for both
 *      agent and path mentions (this is what onSelectOption inserts).
 *   3. Trigger semantics — useBasicTypeaheadTriggerMatch matches `@` preceded
 *      by whitespace or start-of-text, but NOT mid-word.  We verify this via
 *      the same regex the hook uses internally.
 */
import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $getRoot } from "lexical"
import { $createMentionNode, MentionNode } from "../nodes/MentionNode"
import { MentionMenuOption } from "./MentionTypeaheadPlugin"
import type { MentionOption } from "./MentionTypeaheadPlugin"
import type { Subagent } from "../../../../shared/types"

// Minimal Subagent stub for testing — only the fields we need in these tests.
function makeSubagent(id: string, name: string, description?: string): Subagent {
  return { id, name, description } as unknown as Subagent
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEditor() {
  return createHeadlessEditor({
    namespace: "test-mention-plugin",
    nodes: [MentionNode],
    onError: (e: Error) => {
      throw e
    },
  })
}

// ---------------------------------------------------------------------------
// MentionMenuOption
// ---------------------------------------------------------------------------

describe("MentionMenuOption — agent", () => {
  it("derives a stable key from agent id", () => {
    const data: MentionOption = {
      kind: "agent",
      subagent: makeSubagent("sub-123", "builder", "A builder subagent"),
    }
    const option = new MentionMenuOption(data)
    expect(option.key).toBe("agent:sub-123")
    expect(option.data.kind).toBe("agent")
  })

  it("stores subagent data intact", () => {
    const subagent = makeSubagent("abc", "my-agent")
    const option = new MentionMenuOption({ kind: "agent", subagent })
    if (option.data.kind !== "agent") throw new Error("expected agent")
    expect(option.data.subagent.name).toBe("my-agent")
    expect(option.data.subagent.id).toBe("abc")
  })
})

describe("MentionMenuOption — path", () => {
  it("derives a stable key for a file path", () => {
    const data: MentionOption = {
      kind: "path",
      path: { path: "src/server/agent.ts", kind: "file" },
    }
    const option = new MentionMenuOption(data)
    expect(option.key).toBe("path:file:src/server/agent.ts")
    expect(option.data.kind).toBe("path")
  })

  it("derives a stable key for a directory path", () => {
    const data: MentionOption = {
      kind: "path",
      path: { path: "src/server/", kind: "dir" },
    }
    const option = new MentionMenuOption(data)
    expect(option.key).toBe("path:dir:src/server/")
  })

  it("stores path data intact", () => {
    const data: MentionOption = {
      kind: "path",
      path: { path: "README.md", kind: "file" },
    }
    const option = new MentionMenuOption(data)
    if (option.data.kind !== "path") throw new Error("expected path")
    expect(option.data.path.path).toBe("README.md")
    expect(option.data.path.kind).toBe("file")
  })
})

// ---------------------------------------------------------------------------
// Node insertion — wire-form text content
// (mirrors what onSelectOption inserts via $insertNodes)
// ---------------------------------------------------------------------------

describe("MentionNode wire-form text — agent (insertion target)", () => {
  it("inserted agent node serialises to @agent/<name>", () => {
    const editor = buildEditor()
    let text = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "agent",
          value: "builder",
          label: "builder",
        })
        para.append(node)
        root.append(para)
        text = node.getTextContent()
      },
      { discrete: true },
    )

    expect(text).toBe("@agent/builder")
  })

  it("agent node value is used as both value and label", () => {
    const editor = buildEditor()
    let exported: { value: string; label: string; mentionKind: string } | null = null

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "agent",
          value: "researcher",
          label: "researcher",
        })
        para.append(node)
        root.append(para)
        exported = node.exportJSON()
      },
      { discrete: true },
    )

    expect(exported!.mentionKind).toBe("agent")
    expect(exported!.value).toBe("researcher")
    expect(exported!.label).toBe("researcher")
  })
})

describe("MentionNode wire-form text — path (insertion target)", () => {
  it("inserted path node serialises to @<path>", () => {
    const editor = buildEditor()
    let text = ""

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "path",
          value: "src/client/index.ts",
          label: "src/client/index.ts",
        })
        para.append(node)
        root.append(para)
        text = node.getTextContent()
      },
      { discrete: true },
    )

    expect(text).toBe("@src/client/index.ts")
  })

  it("path node value matches the raw path from the suggestion", () => {
    const editor = buildEditor()
    let exported: { value: string; mentionKind: string } | null = null

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createMentionNode({
          mentionKind: "path",
          value: "docs/README.md",
          label: "docs/README.md",
        })
        para.append(node)
        root.append(para)
        exported = node.exportJSON()
      },
      { discrete: true },
    )

    expect(exported!.mentionKind).toBe("path")
    expect(exported!.value).toBe("docs/README.md")
  })
})

// ---------------------------------------------------------------------------
// Trigger pattern — custom MENTION_TRIGGER_RE
// Mirrors shouldShowMentionPicker: `@` at start or after whitespace, query
// includes `/` and `.` so `@agent/builder` and `@src/file.ts` keep the menu
// open throughout typing.
// ---------------------------------------------------------------------------

describe("@ trigger pattern (custom MENTION_TRIGGER_RE semantics)", () => {
  // Mirror the plugin's internal constant.
  const MENTION_TRIGGER_RE = /(?:^|\s)(@((?:[^@\s]){0,200}))$/

  function match(text: string) {
    return MENTION_TRIGGER_RE.exec(text)
  }

  it("matches bare `@` at start of text", () => {
    expect(match("@")).not.toBeNull()
  })

  it("matches `@foo` — query is `foo`", () => {
    const m = match("@foo")
    expect(m).not.toBeNull()
    expect(m![2]).toBe("foo")
  })

  it("matches `@agent/builder` — slash is allowed in the query", () => {
    // `/` is NOT in the excluded set for MENTION_TRIGGER_RE so the menu stays
    // open as the user types `@agent/builder`.
    const m = match("@agent/builder")
    expect(m).not.toBeNull()
    expect(m![2]).toBe("agent/builder")
  })

  it("matches `@src/client/index.ts` — full path query", () => {
    const m = match("@src/client/index.ts")
    expect(m).not.toBeNull()
    expect(m![2]).toBe("src/client/index.ts")
  })

  it("matches `@` after whitespace", () => {
    const m = match("hello @")
    expect(m).not.toBeNull()
  })

  it("does NOT match mid-word @", () => {
    // `no@trigger` — `@` is not preceded by whitespace or start
    expect(match("no@trigger")).toBeNull()
  })

  it("does NOT match when query contains whitespace (space terminates the token)", () => {
    // After `@foo bar`, the space terminates the `[^@\s]*` group so no match.
    expect(match("@foo bar")).toBeNull()
  })

  it("replaceableString is the full `@query` text to replace", () => {
    const m = match("@agent/builder")
    // match[1] is the full `@query` portion
    expect(m![1]).toBe("@agent/builder")
  })
})
