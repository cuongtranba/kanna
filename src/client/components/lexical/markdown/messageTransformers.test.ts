/**
 * messageTransformers.test.ts
 *
 * Tests for KANNA_MESSAGE_TRANSFORMERS:
 *  - MERMAID_FENCE: ```mermaid fences → MermaidNode
 *  - LOCAL_FILE_LINK: [text](/abs/path) → LocalFileLinkNode
 */

import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $convertFromMarkdownString } from "@lexical/markdown"
import { $getRoot, type LexicalNode } from "lexical"
import {
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text"
import { ListNode, ListItemNode } from "@lexical/list"
import { LinkNode, AutoLinkNode } from "@lexical/link"
import { CodeNode, CodeHighlightNode } from "@lexical/code"
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table"
import {
  $isMermaidNode,
  $isLocalFileLinkNode,
  ThinkingNode,
  KANNA_MESSAGE_NODES,
} from "../nodes"
import { KANNA_MESSAGE_TRANSFORMERS } from "./messageTransformers"
import type { LexicalEditor } from "lexical"

// ---------------------------------------------------------------------------
// Test editor factory
// ---------------------------------------------------------------------------

const GFM_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
]

function buildEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "test-message-transformers",
    nodes: [...GFM_NODES, ...KANNA_MESSAGE_NODES],
    onError: (e: Error) => {
      throw e
    },
  })
}

/**
 * Parse markdown using KANNA_MESSAGE_TRANSFORMERS and return the editor.
 * All node inspection MUST happen inside editor.getEditorState().read().
 */
function parseMarkdown(markdown: string): LexicalEditor {
  const editor = buildEditor()
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, KANNA_MESSAGE_TRANSFORMERS, undefined, true)
    },
    { discrete: true },
  )
  return editor
}

/**
 * Flatten all nodes in the tree (depth-first) into a flat list.
 * MUST be called inside an editor.getEditorState().read() callback.
 */
function flattenNodes(nodes: LexicalNode[]): LexicalNode[] {
  const result: LexicalNode[] = []
  function visit(node: LexicalNode) {
    result.push(node)
    if ("getChildren" in node && typeof (node as { getChildren: () => LexicalNode[] }).getChildren === "function") {
      const children = (node as { getChildren: () => LexicalNode[] }).getChildren()
      for (const child of children) {
        visit(child)
      }
    }
  }
  for (const node of nodes) {
    visit(node)
  }
  return result
}

// ---------------------------------------------------------------------------
// MERMAID_FENCE tests
// ---------------------------------------------------------------------------

describe("MERMAID_FENCE transformer", () => {
  it("converts a ```mermaid fence to a MermaidNode", () => {
    const markdown = "```mermaid\ngraph LR\nA-->B\n```"
    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const mermaidNodes = allNodes.filter($isMermaidNode)
      expect(mermaidNodes.length).toBeGreaterThanOrEqual(1)
      expect(mermaidNodes[0]!.getTextContent()).toBe("graph LR\nA-->B")
    })
  })

  it("preserves multiline mermaid source", () => {
    const source = "sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Hi"
    const markdown = `\`\`\`mermaid\n${  source  }\n\`\`\``
    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const mermaidNodes = allNodes.filter($isMermaidNode)
      expect(mermaidNodes.length).toBeGreaterThanOrEqual(1)
      expect(mermaidNodes[0]!.getTextContent()).toBe(source)
    })
  })

  it("does NOT create a MermaidNode for non-mermaid code fences", () => {
    const markdown = "```typescript\nconsole.log('hello')\n```"
    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const mermaidNodes = allNodes.filter($isMermaidNode)
      expect(mermaidNodes.length).toBe(0)
    })
  })

  it("creates a MermaidNode alongside other content", () => {
    const markdown = "# Title\n\n```mermaid\ngraph TD\nX-->Y\n```\n\nSome text"
    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const mermaidNodes = allNodes.filter($isMermaidNode)
      expect(mermaidNodes.length).toBeGreaterThanOrEqual(1)
      expect(mermaidNodes[0]!.getTextContent()).toBe("graph TD\nX-->Y")
    })
  })

  it("handles case-insensitive mermaid fence language", () => {
    const markdown = "```Mermaid\npie\n title Test\n ```"
    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const mermaidNodes = allNodes.filter($isMermaidNode)
      expect(mermaidNodes.length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ---------------------------------------------------------------------------
// LOCAL_FILE_LINK tests
// ---------------------------------------------------------------------------

describe("LOCAL_FILE_LINK transformer", () => {
  it("converts a link with /Users/ path to LocalFileLinkNode", () => {
    const markdown = "[open file](/Users/alice/project/src/main.ts)"
    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const localFileNodes = allNodes.filter($isLocalFileLinkNode)
      expect(localFileNodes.length).toBeGreaterThanOrEqual(1)
      expect(localFileNodes[0]!.getTextContent()).toBe("/Users/alice/project/src/main.ts")
    })
  })

  it("converts a link with /home/ path to LocalFileLinkNode", () => {
    const markdown = "[src](/home/user/workspace/src/index.ts)"
    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const localFileNodes = allNodes.filter($isLocalFileLinkNode)
      expect(localFileNodes.length).toBeGreaterThanOrEqual(1)
    })
  })

  it("does NOT convert external https:// links to LocalFileLinkNode", () => {
    const markdown = "[visit](https://example.com)"
    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const localFileNodes = allNodes.filter($isLocalFileLinkNode)
      expect(localFileNodes.length).toBe(0)
    })
  })

  it("does NOT convert relative links to LocalFileLinkNode", () => {
    const markdown = "[relative](./some/relative/path.ts)"
    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const localFileNodes = allNodes.filter($isLocalFileLinkNode)
      expect(localFileNodes.length).toBe(0)
    })
  })

  it("LocalFileLinkNode has correct path as text content", () => {
    const path = "/Users/bob/code/app/README.md"
    const markdown = `[readme](${path})`
    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const localFileNodes = allNodes.filter($isLocalFileLinkNode)
      expect(localFileNodes.length).toBeGreaterThanOrEqual(1)
      expect(localFileNodes[0]!.getTextContent()).toBe(path)
    })
  })
})

// ---------------------------------------------------------------------------
// Combined content tests
// ---------------------------------------------------------------------------

describe("KANNA_MESSAGE_TRANSFORMERS combined", () => {
  it("handles both mermaid and regular code blocks in same document", () => {
    const markdown = [
      "```mermaid",
      "graph LR",
      "A-->B",
      "```",
      "",
      "```typescript",
      "const x = 1",
      "```",
    ].join("\n")

    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const mermaidNodes = allNodes.filter($isMermaidNode)
      // Should have exactly one mermaid node and NO MermaidNode for the ts block
      expect(mermaidNodes.length).toBe(1)
      expect(mermaidNodes[0]!.getTextContent()).toBe("graph LR\nA-->B")
    })
  })

  it("ThinkingNode class is registered but not created by transformers (transformers don't produce ThinkingNodes)", () => {
    // Verify ThinkingNode is in the node set (no import errors)
    expect(ThinkingNode.getType()).toBe("kanna-thinking")
    // Transformers don't parse <think> tags - that's handled at the renderMessage layer
    const markdown = "<think>some thinking</think>"
    const editor = parseMarkdown(markdown)
    editor.getEditorState().read(() => {
      const allNodes = flattenNodes($getRoot().getChildren<LexicalNode>())
      const thinkingNodes = allNodes.filter((n) => n instanceof ThinkingNode)
      expect(thinkingNodes.length).toBe(0)
    })
  })
})
