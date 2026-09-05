
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


function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed
  const stripped = inner.endsWith("|") ? inner.slice(0, -1) : inner
  return stripped.split("|").map((cell) => cell.trim())
}

function isTableAlignRow(line: string): boolean {
  const cells = splitTableRow(line)
  return (
    cells.length > 0 &&
    cells.every((c) => /^:?-+:?$/.test(c.trim()) && c.trim().length >= 1)
  )
}


export const GFM_TABLE: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [TableNode, TableRowNode, TableCellNode],

  regExpStart: /^\|?[^|]*\|.*$/,

  regExpEnd: { optional: true, regExp: /^\x00$/ },

  handleImportAfterStartMatch({ lines, rootNode, startLineIndex }) {
    const headerLine = lines[startLineIndex]
    if (headerLine === undefined) return null

    const separatorLine = lines[startLineIndex + 1]
    if (separatorLine === undefined || !isTableAlignRow(separatorLine)) {
      return null
    }

    const headerCells = splitTableRow(headerLine)
    const colCount = headerCells.length

    const bodyRows: string[][] = []
    let lastLineIndex = startLineIndex + 1
    for (let i = startLineIndex + 2; i < lines.length; i++) {
      const line = lines[i]
      if (line === undefined) break
      if (!line.trim().includes("|") && line.trim() !== "") break
      if (line.trim() === "") break
      bodyRows.push(splitTableRow(line))
      lastLineIndex = i
    }

    const tableNode = $createTableNode()

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
        lines.push(`| ${cells.map(() => "---").join(" | ")} |`)
      }
    })
    return lines.join("\n")
  },
}


export const KANNA_BUILTIN_TRANSFORMERS: Array<Transformer> = [
  GFM_TABLE,
  CHECK_LIST,
  ...TRANSFORMERS,
]
