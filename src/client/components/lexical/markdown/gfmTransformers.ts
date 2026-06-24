/**
 * GFM transformer set for Kanna's headless markdown renderer.
 *
 * Coverage:
 *  - Headings h1–h6           (HEADING — default)
 *  - Blockquotes              (QUOTE — default)
 *  - Fenced code blocks       (CODE — default)
 *  - Unordered lists          (UNORDERED_LIST — default)
 *  - Ordered lists            (ORDERED_LIST — default)
 *  - Task / checkbox lists    (CHECK_LIST — default)
 *  - Inline code              (INLINE_CODE — default)
 *  - Bold                     (BOLD_STAR, BOLD_UNDERSCORE, BOLD_ITALIC_STAR, BOLD_ITALIC_UNDERSCORE — default)
 *  - Italic                   (ITALIC_STAR, ITALIC_UNDERSCORE — default)
 *  - Strikethrough ~~text~~   (STRIKETHROUGH — default)
 *  - Links [text](url)        (LINK — default)
 *  - GFM pipe tables          (GFM_TABLE — custom MultilineElementTransformer, see below)
 *
 * Note: @lexical/markdown's TRANSFORMERS contains STRIKETHROUGH and LINK
 * but NOT CHECK_LIST (as of @lexical/markdown 0.45). CHECK_LIST must be
 * added explicitly to enable task-list parsing.
 * GFM_TABLE is the only addition beyond the built-in defaults for tables.
 */

import {
  CHECK_LIST,
  TRANSFORMERS,
  type MultilineElementTransformer,
  type Transformer,
} from "@lexical/markdown"
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table"
import { $createParagraphNode, $createTextNode, type ElementNode, type LexicalNode } from "lexical"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip leading/trailing pipe and whitespace from a table row string. */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  // Remove optional surrounding pipes
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed
  const stripped = inner.endsWith("|") ? inner.slice(0, -1) : inner
  return stripped.split("|").map((cell) => cell.trim())
}

/** Returns true when the line is a GFM table separator row (e.g. `| --- | :---: |`). */
function isTableAlignRow(line: string): boolean {
  const cells = splitTableRow(line)
  return (
    cells.length > 0 &&
    cells.every((c) => /^:?-+:?$/.test(c.trim()) && c.trim().length >= 1)
  )
}

// ---------------------------------------------------------------------------
// GFM_TABLE: MultilineElementTransformer
// ---------------------------------------------------------------------------
// Matches a block that starts with a pipe-table header row, followed by a
// separator row, then zero-or-more data rows.
//
// regExpStart matches any line that looks like a table row: starts (optionally)
// with a pipe, contains at least one |, ends optionally with pipe.
// regExpEnd is optional — we consume lines in handleImportAfterStartMatch.
// ---------------------------------------------------------------------------

export const GFM_TABLE: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [TableNode, TableRowNode, TableCellNode],

  // Matches any line containing at least one pipe character (table row or separator).
  regExpStart: /^\|?[^|]*\|.*$/,

  // We handle everything manually, so regExpEnd is set to an unlikely sentinel.
  regExpEnd: { optional: true, regExp: /^\x00$/ },

  handleImportAfterStartMatch({ lines, rootNode, startLineIndex }) {
    const headerLine = lines[startLineIndex]
    if (headerLine === undefined) return null

    const separatorLine = lines[startLineIndex + 1]
    // Must have a separator row immediately after the header
    if (separatorLine === undefined || !isTableAlignRow(separatorLine)) {
      return null
    }

    const headerCells = splitTableRow(headerLine)
    const colCount = headerCells.length

    // Collect body rows: lines after the separator that look like table rows
    const bodyRows: string[][] = []
    let lastLineIndex = startLineIndex + 1 // separator consumed
    for (let i = startLineIndex + 2; i < lines.length; i++) {
      const line = lines[i]
      if (line === undefined) break
      // A line is part of the table if it contains a pipe; empty lines end it
      if (!line.trim().includes("|") && line.trim() !== "") break
      if (line.trim() === "") break
      bodyRows.push(splitTableRow(line))
      lastLineIndex = i
    }

    // Build the TableNode
    const tableNode = $createTableNode()

    // Header row
    const headerRow = $createTableRowNode()
    for (let c = 0; c < colCount; c++) {
      const cell = $createTableCellNode(TableCellHeaderStates.ROW)
      const para = $createParagraphNode()
      const cellText = headerCells[c] ?? ""
      para.append($createTextNode(cellText))
      cell.append(para)
      headerRow.append(cell)
    }
    tableNode.append(headerRow)

    // Body rows
    for (const rowCells of bodyRows) {
      const row = $createTableRowNode()
      for (let c = 0; c < colCount; c++) {
        const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS)
        const para = $createParagraphNode()
        const cellText = rowCells[c] ?? ""
        para.append($createTextNode(cellText))
        cell.append(para)
        row.append(cell)
      }
      tableNode.append(row)
    }

    rootNode.append(tableNode)
    return [true, lastLineIndex]
  },

  replace(_rootNode, _children, _startMatch, _endMatch, _linesInBetween, _isImport) {
    // This path is used for typed shortcuts — not applicable for static import.
    // Return false to skip.
    return false
  },

  export(node: LexicalNode, traverseChildren: (n: ElementNode) => string) {
    if (!$isTableNode(node)) return null

    const rows = node.getChildren<TableRowNode>()
    if (rows.length === 0) return null

    const lines: string[] = []
    rows.forEach((row, rowIndex) => {
      if (!$isTableRowNode(row)) return
      const cells = row.getChildren<TableCellNode>()
      const cellTexts = cells.map((cell) => {
        if (!$isTableCellNode(cell)) return ""
        return traverseChildren(cell).trim()
      })
      lines.push(`| ${cellTexts.join(" | ")} |`)
      if (rowIndex === 0) {
        // Insert separator after header
        lines.push(`| ${cells.map(() => "---").join(" | ")} |`)
      }
    })
    return lines.join("\n")
  },
}

// ---------------------------------------------------------------------------
// Exported transformer list
// ---------------------------------------------------------------------------

/**
 * Full GFM transformer set for Kanna's headless renderer.
 * Extends the default @lexical/markdown TRANSFORMERS with:
 *  - GFM_TABLE (prepended for priority over plain-text multiline matchers)
 *  - CHECK_LIST (not in TRANSFORMERS as of @lexical/markdown 0.45, must be explicit)
 */
export const KANNA_BUILTIN_TRANSFORMERS: Array<Transformer> = [
  GFM_TABLE,
  CHECK_LIST,
  ...TRANSFORMERS,
]
