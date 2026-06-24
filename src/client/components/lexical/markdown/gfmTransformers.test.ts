/**
 * Tests for KANNA_BUILTIN_TRANSFORMERS: verifies that the GFM transformer set
 * produces the expected Lexical node types from representative markdown inputs.
 *
 * All node inspection is done inside editor.getEditorState().read() callbacks
 * to respect Lexical's read-context requirement.
 */
import { describe, expect, test } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $convertFromMarkdownString } from "@lexical/markdown"
import {
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text"
import {
  $isListItemNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list"
import { $isLinkNode, AutoLinkNode, LinkNode } from "@lexical/link"
import {
  $isCodeNode,
  CodeNode,
  CodeHighlightNode,
} from "@lexical/code"
import {
  $isTableNode,
  $isTableRowNode,
  $isTableCellNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table"
import {
  $getRoot,
  $isParagraphNode,
  $isTextNode,
  IS_BOLD,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  IS_CODE,
  type LexicalNode,
} from "lexical"
import { KANNA_BUILTIN_TRANSFORMERS } from "./gfmTransformers"
import { buildKannaEditorConfig } from "../config"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_NODES = [
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

function makeEditor() {
  return createHeadlessEditor(
    buildKannaEditorConfig({
      namespace: "test",
      nodes: ALL_NODES,
      editable: false,
    }),
  )
}

function parseMarkdown(markdown: string) {
  const editor = makeEditor()
  editor.update(() => {
    $convertFromMarkdownString(markdown, KANNA_BUILTIN_TRANSFORMERS, undefined, true)
  }, { discrete: true })
  return editor
}

/** Deep-traverse all nodes, collecting those passing the predicate, within a read context. */
function collectNodes<T extends LexicalNode>(
  editor: ReturnType<typeof makeEditor>,
  predicate: (node: LexicalNode) => node is T,
): T[] {
  return editor.getEditorState().read(() => {
    const result: T[] = []
    function traverse(node: LexicalNode): void {
      if (predicate(node)) result.push(node)
      if ("getChildren" in node && typeof (node as unknown as { getChildren: () => LexicalNode[] }).getChildren === "function") {
        for (const child of (node as unknown as { getChildren: () => LexicalNode[] }).getChildren()) {
          traverse(child)
        }
      }
    }
    traverse($getRoot())
    return result
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KANNA_BUILTIN_TRANSFORMERS", () => {
  // ---- Headings ------------------------------------------------------------

  test("h1 heading", () => {
    const editor = parseMarkdown("# Hello World")
    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren<LexicalNode>()
      expect(children.length).toBeGreaterThan(0)
      const heading = children[0]
      expect($isHeadingNode(heading)).toBe(true)
      if ($isHeadingNode(heading)) {
        expect(heading.getTag()).toBe("h1")
      }
    })
  })

  test("h2 heading", () => {
    const editor = parseMarkdown("## Section")
    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren<LexicalNode>()
      const heading = children[0]
      expect($isHeadingNode(heading)).toBe(true)
      if ($isHeadingNode(heading)) {
        expect(heading.getTag()).toBe("h2")
      }
    })
  })

  test("h3 heading", () => {
    const editor = parseMarkdown("### Sub-section")
    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren<LexicalNode>()
      const heading = children[0]
      expect($isHeadingNode(heading)).toBe(true)
      if ($isHeadingNode(heading)) {
        expect(heading.getTag()).toBe("h3")
      }
    })
  })

  // ---- Blockquote ----------------------------------------------------------

  test("blockquote", () => {
    const editor = parseMarkdown("> This is a quote")
    const quotes = collectNodes(editor, $isQuoteNode)
    expect(quotes.length).toBeGreaterThan(0)
  })

  // ---- Bold / italic / strikethrough / inline-code -------------------------

  test("bold text (** markers)", () => {
    const editor = parseMarkdown("**bold text**")
    const boldFound = editor.getEditorState().read(() => {
      const result: boolean[] = []
      function traverse(node: LexicalNode): void {
        if ($isTextNode(node) && (node.getFormat() & IS_BOLD) !== 0) result.push(true)
        if ("getChildren" in node && typeof (node as unknown as { getChildren: () => LexicalNode[] }).getChildren === "function") {
          for (const child of (node as unknown as { getChildren: () => LexicalNode[] }).getChildren()) traverse(child)
        }
      }
      traverse($getRoot())
      return result.length > 0
    })
    expect(boldFound).toBe(true)
  })

  test("italic text (* marker)", () => {
    const editor = parseMarkdown("*italic*")
    const italicFound = editor.getEditorState().read(() => {
      const result: boolean[] = []
      function traverse(node: LexicalNode): void {
        if ($isTextNode(node) && (node.getFormat() & IS_ITALIC) !== 0) result.push(true)
        if ("getChildren" in node && typeof (node as unknown as { getChildren: () => LexicalNode[] }).getChildren === "function") {
          for (const child of (node as unknown as { getChildren: () => LexicalNode[] }).getChildren()) traverse(child)
        }
      }
      traverse($getRoot())
      return result.length > 0
    })
    expect(italicFound).toBe(true)
  })

  test("strikethrough (~~text~~)", () => {
    const editor = parseMarkdown("~~strikethrough~~")
    const strikeFound = editor.getEditorState().read(() => {
      const result: boolean[] = []
      function traverse(node: LexicalNode): void {
        if ($isTextNode(node) && (node.getFormat() & IS_STRIKETHROUGH) !== 0) result.push(true)
        if ("getChildren" in node && typeof (node as unknown as { getChildren: () => LexicalNode[] }).getChildren === "function") {
          for (const child of (node as unknown as { getChildren: () => LexicalNode[] }).getChildren()) traverse(child)
        }
      }
      traverse($getRoot())
      return result.length > 0
    })
    expect(strikeFound).toBe(true)
  })

  test("inline code (`code`)", () => {
    const editor = parseMarkdown("Use `console.log()` here")
    const codeFound = editor.getEditorState().read(() => {
      const result: boolean[] = []
      function traverse(node: LexicalNode): void {
        if ($isTextNode(node) && (node.getFormat() & IS_CODE) !== 0) result.push(true)
        if ("getChildren" in node && typeof (node as unknown as { getChildren: () => LexicalNode[] }).getChildren === "function") {
          for (const child of (node as unknown as { getChildren: () => LexicalNode[] }).getChildren()) traverse(child)
        }
      }
      traverse($getRoot())
      return result.length > 0
    })
    expect(codeFound).toBe(true)
  })

  // ---- Code fence ----------------------------------------------------------

  test("fenced code block", () => {
    const md = "```typescript\nconst x = 1\n```"
    const editor = parseMarkdown(md)
    editor.getEditorState().read(() => {
      const codeNodes = collectNodes(editor, $isCodeNode)
      expect(codeNodes.length).toBeGreaterThan(0)
      const language = codeNodes[0]?.getLanguage()
      expect(language).toBe("typescript")
    })
  })

  // ---- Link ----------------------------------------------------------------

  test("inline link", () => {
    const editor = parseMarkdown("[Kanna](https://example.com)")
    editor.getEditorState().read(() => {
      const links = collectNodes(editor, $isLinkNode)
      expect(links.length).toBeGreaterThan(0)
      const url = links[0]?.getURL()
      expect(url).toBe("https://example.com")
    })
  })

  // ---- Unordered list ------------------------------------------------------

  test("unordered list produces bullet ListNode with 3 items", () => {
    const md = "- alpha\n- beta\n- gamma"
    const editor = parseMarkdown(md)
    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren<LexicalNode>()
      const list = children.find($isListNode)
      expect(list).toBeDefined()
      if (list && $isListNode(list)) {
        expect(list.getListType()).toBe("bullet")
        const items = list.getChildren<LexicalNode>().filter($isListItemNode)
        expect(items.length).toBe(3)
      }
    })
  })

  // ---- Ordered list --------------------------------------------------------

  test("ordered list produces number ListNode with 3 items", () => {
    const md = "1. first\n2. second\n3. third"
    const editor = parseMarkdown(md)
    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren<LexicalNode>()
      const list = children.find($isListNode)
      expect(list).toBeDefined()
      if (list && $isListNode(list)) {
        expect(list.getListType()).toBe("number")
        const items = list.getChildren<LexicalNode>().filter($isListItemNode)
        expect(items.length).toBe(3)
      }
    })
  })

  // ---- Checkbox / task list ------------------------------------------------

  test("task list with checked and unchecked items", () => {
    const md = "- [x] Done\n- [ ] Pending"
    const editor = parseMarkdown(md)
    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren<LexicalNode>()
      const list = children.find($isListNode)
      expect(list).toBeDefined()
      if (list && $isListNode(list)) {
        expect(list.getListType()).toBe("check")
        const items = list.getChildren<ListItemNode>().filter($isListItemNode)
        expect(items.length).toBe(2)
        expect(items[0]?.getChecked()).toBe(true)
        expect(items[1]?.getChecked()).toBe(false)
      }
    })
  })

  // ---- GFM pipe table ------------------------------------------------------

  test("GFM pipe table produces TableNode with header and body rows", () => {
    const md = [
      "| Name   | Age |",
      "| ------ | --- |",
      "| Alice  | 30  |",
      "| Bob    | 25  |",
    ].join("\n")

    const editor = parseMarkdown(md)
    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren<LexicalNode>()
      const table = children.find($isTableNode)
      expect(table).toBeDefined()

      if (table && $isTableNode(table)) {
        const rows = table.getChildren<LexicalNode>().filter($isTableRowNode)
        // header row + 2 body rows = 3
        expect(rows.length).toBe(3)

        const headerRow = rows[0]
        if (headerRow && $isTableRowNode(headerRow)) {
          const headerCells = headerRow.getChildren<LexicalNode>().filter($isTableCellNode)
          expect(headerCells.length).toBe(2)
          // All header cells carry the ROW header state
          for (const cell of headerCells) {
            if ($isTableCellNode(cell)) {
              expect(cell.hasHeader()).toBe(true)
            }
          }
        }

        const bodyRow1 = rows[1]
        if (bodyRow1 && $isTableRowNode(bodyRow1)) {
          const cells = bodyRow1.getChildren<LexicalNode>().filter($isTableCellNode)
          expect(cells.length).toBe(2)
        }
      }
    })
  })

  // ---- Nested list ---------------------------------------------------------

  test("nested unordered list has at least one ListItemNode", () => {
    const md = "- parent\n  - child A\n  - child B"
    const editor = parseMarkdown(md)
    const items = collectNodes(editor, $isListItemNode)
    expect(items.length).toBeGreaterThan(0)
  })

  // ---- Paragraph -----------------------------------------------------------

  test("plain paragraph produces ParagraphNode", () => {
    const editor = parseMarkdown("Just a plain paragraph.")
    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren<LexicalNode>()
      expect(children.some($isParagraphNode)).toBe(true)
    })
  })

  // ---- Transformer count ---------------------------------------------------

  test("KANNA_BUILTIN_TRANSFORMERS is longer than default TRANSFORMERS by exactly 2", async () => {
    const { TRANSFORMERS } = await import("@lexical/markdown")
    // GFM_TABLE + CHECK_LIST (not in default TRANSFORMERS as of 0.45) + all default TRANSFORMERS
    expect(KANNA_BUILTIN_TRANSFORMERS.length).toBe(TRANSFORMERS.length + 2)
  })
})
