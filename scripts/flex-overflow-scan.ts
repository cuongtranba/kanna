import ts from "typescript"
import { Glob } from "bun"
import { join, relative } from "node:path"

export const CLIENT_SCOPE = { dir: "src/client", glob: "**/*.tsx" } as const

export type FlexOverflowReason = "undeclared-text" | "nothing-yields"

export interface FlexOverflowHit {
  readonly line: number
  readonly reason: FlexOverflowReason
  readonly snippet: string
}

const RIGID_UTILITIES = new Set(["shrink-0", "flex-none", "whitespace-nowrap"])
const YIELDING_UTILITIES = new Set(["truncate", "break-all", "wrap-anywhere", "overflow-hidden", "overflow-x-hidden"])
const WRAPPING_UTILITIES = new Set(["break-words", "wrap-break-word"])
const COLUMN_UTILITIES = new Set(["flex-col", "flex-col-reverse"])
const WRAP_UTILITIES = new Set(["flex-wrap", "flex-wrap-reverse"])
const ROW_DISPLAY_UTILITIES = new Set(["flex", "inline-flex"])

interface ClassList {
  readonly bare: ReadonlySet<string>
  readonly anyVariant: ReadonlySet<string>
}

function toClassList(text: string): ClassList {
  const tokens = text.split(/\s+/).filter((token) => token.length > 0)
  return {
    bare: new Set(tokens),
    anyVariant: new Set(tokens.map((token) => token.slice(token.lastIndexOf(":") + 1))),
  }
}

const EMPTY_CLASSES = toClassList("")

function hasAny(set: ReadonlySet<string>, wanted: ReadonlySet<string>): boolean {
  for (const token of set) if (wanted.has(token)) return true
  return false
}

function collectStaticText(node: ts.Node, parts: string[]): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    parts.push(node.text)
    return
  }
  if (ts.isTemplateExpression(node)) {
    parts.push(node.head.text)
    for (const span of node.templateSpans) {
      collectStaticText(span.expression, parts)
      parts.push(span.literal.text)
    }
    return
  }
  node.forEachChild((child) => collectStaticText(child, parts))
}

function classesOf(element: ts.JsxOpeningLikeElement): ClassList {
  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== "className") continue
    const initializer = attribute.initializer
    if (initializer === undefined) return EMPTY_CLASSES
    const parts: string[] = []
    collectStaticText(initializer, parts)
    return toClassList(parts.join(" "))
  }
  return EMPTY_CLASSES
}

function isNonWrappingRow(classes: ClassList): boolean {
  if (!hasAny(classes.anyVariant, ROW_DISPLAY_UTILITIES)) return false
  if (hasAny(classes.anyVariant, WRAP_UTILITIES)) return false
  return !hasAny(classes.bare, COLUMN_UTILITIES)
}

function isRigid(classes: ClassList): boolean {
  return hasAny(classes.anyVariant, RIGID_UTILITIES)
}

function isYielding(classes: ClassList): boolean {
  if (hasAny(classes.anyVariant, YIELDING_UTILITIES)) return true
  for (const token of classes.anyVariant) if (token.startsWith("line-clamp-")) return true
  return classes.anyVariant.has("min-w-0") && hasAny(classes.anyVariant, WRAPPING_UTILITIES)
}

const SLOT_YIELDING_UTILITIES = new Set(["min-w-0", "overflow-auto", "overflow-x-auto", "overflow-scroll", "overflow-x-scroll"])

function slotYields(classes: ClassList): boolean {
  return isYielding(classes) || hasAny(classes.anyVariant, SLOT_YIELDING_UTILITIES)
}

function rendersData(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return rendersData(expression.expression)
  if (ts.isConditionalExpression(expression)) {
    return rendersData(expression.whenTrue) || rendersData(expression.whenFalse)
  }
  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return rendersData(expression.right)
    return rendersData(expression.left) || rendersData(expression.right)
  }
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression) ||
    ts.isJsxFragment(expression)
  ) {
    return false
  }
  return expression.kind !== ts.SyntaxKind.NullKeyword
}

interface RowChild {
  readonly node: ts.JsxElement | ts.JsxSelfClosingElement
  readonly classes: ClassList
}

function rowChildren(row: ts.JsxElement): RowChild[] {
  const found: RowChild[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      found.push({ node, classes: classesOf(node.openingElement) })
      return
    }
    if (ts.isJsxSelfClosingElement(node)) {
      found.push({ node, classes: classesOf(node) })
      return
    }
    if (
      ts.isJsxExpression(node) ||
      ts.isJsxFragment(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isConditionalExpression(node) ||
      ts.isBinaryExpression(node)
    ) {
      node.forEachChild(visit)
    }
  }
  for (const child of row.children) visit(child)
  return found
}

function isDataText(child: RowChild): child is RowChild & { readonly node: ts.JsxElement } {
  if (!ts.isJsxElement(child.node)) return false
  const tag = child.node.openingElement.tagName.getText()
  if (tag !== tag.toLowerCase()) return false
  if (child.classes.anyVariant.has("sr-only")) return false
  return child.node.children.some(
    (grandchild) => ts.isJsxExpression(grandchild) && grandchild.expression !== undefined && rendersData(grandchild.expression),
  )
}

function snippetOf(source: ts.SourceFile, node: ts.Node): string {
  const firstLine = node.getText(source).split("\n")[0] ?? ""
  return firstLine.trim().slice(0, 110)
}

export function findSqueezedFlexText(fileName: string, text: string): FlexOverflowHit[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits: FlexOverflowHit[] = []
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1

  const visit = (node: ts.Node): void => {
    const rowClasses = ts.isJsxElement(node) ? classesOf(node.openingElement) : EMPTY_CLASSES
    if (ts.isJsxElement(node) && isNonWrappingRow(rowClasses) && !isRigid(rowClasses)) {
      const children = rowChildren(node)
      const holds = (child: RowChild): boolean => isRigid(child.classes) && !slotYields(child.classes)
      if (children.some(holds)) {
        const dataText = children.filter(isDataText)
        for (const child of dataText) {
          if (isYielding(child.classes) || isRigid(child.classes)) continue
          hits.push({ line: lineOf(child.node), reason: "undeclared-text", snippet: snippetOf(source, child.node) })
        }
        if (dataText.length > 0 && children.every(holds)) {
          hits.push({ line: lineOf(node), reason: "nothing-yields", snippet: snippetOf(source, node.openingElement) })
        }
      }
    }
    node.forEachChild(visit)
  }
  visit(source)
  return hits
}

export async function listClientFiles(repoRoot: string): Promise<string[]> {
  const files: string[] = []
  const glob = new Glob(CLIENT_SCOPE.glob)
  for await (const found of glob.scan({ cwd: join(repoRoot, CLIENT_SCOPE.dir), absolute: true, onlyFiles: true })) {
    if (found.includes(".test.")) continue
    files.push(relative(repoRoot, found))
  }
  return files.sort()
}
