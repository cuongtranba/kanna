import { describe, expect, test } from "vite-plus/test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { COMMAND_REGISTRY } from "../shared/commands"

const SERVER_DIR = import.meta.dirname
const COMMAND_TYPE_SHAPE = /^[a-z][A-Za-z]*(?:\.[A-Za-z]+)+$/

const HANDLER_FILES = readdirSync(SERVER_DIR)
  .filter((name) => name.startsWith("ws-router") && name.endsWith(".ts") && !name.includes(".test."))

interface Claims {
  readonly exact: ReadonlyMap<string, readonly string[]>
  readonly prefixes: ReadonlyMap<string, readonly string[]>
}

function isCommandTypeAccess(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node) && node.name.text === "type" && node.expression.getText() === "command"
}

function stringLiteralText(node: ts.Node): string | null {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null
}

function collectClaims(): Claims {
  const exact = new Map<string, string[]>()
  const prefixes = new Map<string, string[]>()
  const remember = (into: Map<string, string[]>, literal: string, file: string) => {
    into.set(literal, [...(into.get(literal) ?? []), file])
  }
  for (const file of HANDLER_FILES) {
    const source = ts.createSourceFile(file, readFileSync(join(SERVER_DIR, file), "utf8"), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node) => {
      if (ts.isCaseClause(node) && ts.isSwitchStatement(node.parent.parent) && isCommandTypeAccess(node.parent.parent.expression)) {
        const literal = stringLiteralText(node.expression)
        if (literal !== null) remember(exact, literal, file)
      }
      if (ts.isBinaryExpression(node)) {
        const operator = node.operatorToken.kind
        const isComparison = operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
        const literalSide = isCommandTypeAccess(node.left) ? node.right : node.left
        const typeSide = isCommandTypeAccess(node.left) ? node.left : node.right
        const literal = isComparison && isCommandTypeAccess(typeSide) ? stringLiteralText(literalSide) : null
        if (literal !== null) remember(exact, literal, file)
      }
      if (ts.isArrayLiteralExpression(node)) {
        const literals = node.elements.map(stringLiteralText)
        const allCommandTypes = literals.length > 0 && literals.every((literal) => literal !== null && COMMAND_TYPE_SHAPE.test(literal))
        if (allCommandTypes) for (const literal of literals) if (literal !== null) remember(exact, literal, file)
      }
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "startsWith"
        && isCommandTypeAccess(node.expression.expression)
      ) {
        const [argument] = node.arguments
        const literal = argument ? stringLiteralText(argument) : null
        if (literal !== null) remember(prefixes, literal, file)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { exact, prefixes }
}

describe("ws-router command coverage", () => {
  const registered = COMMAND_REGISTRY.map((definition) => definition.type)
  const claims = collectClaims()

  test("the registry and the handler modules are both discoverable", () => {
    expect(HANDLER_FILES.length).toBeGreaterThan(5)
    expect(registered.length).toBeGreaterThan(100)
    expect(claims.exact.size).toBeGreaterThan(100)
  })

  test("every registry command is named by a ws-router handler, not merely covered by a prefix guard", () => {
    expect(registered.filter((type) => !claims.exact.has(type))).toEqual([])
  })

  test("every command literal a ws-router handler claims is a registry command", () => {
    const known = new Set<string>(registered)
    const stray = [...claims.exact].filter(([literal]) => !known.has(literal)).map(([literal, files]) => `${literal} (${files.join(", ")})`)
    expect(stray).toEqual([])
  })

  test("every prefix a ws-router handler guards on matches at least one registry command", () => {
    const unmatched = [...claims.prefixes].filter(([prefix]) => !registered.some((type) => type.startsWith(prefix)))
    expect(unmatched.map(([prefix, files]) => `${prefix} (${files.join(", ")})`)).toEqual([])
  })
})
