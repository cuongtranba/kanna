import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { HTTP_ROUTES, listHttpRoutes } from "../../shared/http-routes"

const ROOT = join(import.meta.dir, "..", "..", "..")
const INVENTORY_MODULE = "src/shared/http-routes.ts"
const WEB_CLIENT_ROOTS = ["src/client", "src/shared"]
const ROUTE_ROOTS = ["src/client", "src/shared", "src/server"]
const SERVER_ROUTE_PREFIX = /^\/(?:api|auth|ws)(?:[/?]|$)/

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(dir, name)
    if (statSync(join(ROOT, path)).isDirectory()) {
      if (name !== "__fixtures__" && name !== "testing" && name !== "test-helpers") sourceFiles(path, found)
      continue
    }
    if (/\.tsx?$/.test(name) && !/\.(test|pw)\.tsx?$/.test(name)) found.push(path)
  }
  return found
}

function literalTexts(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true)
  const texts: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) texts.push(node.text)
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) texts.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return texts
}

describe("http route inventory", () => {
  test("no web client or shared module spells a Kanna route itself, so every route the client calls is built from the inventory", () => {
    const offenders: string[] = []
    for (const root of WEB_CLIENT_ROOTS) {
      for (const file of sourceFiles(root)) {
        if (file === INVENTORY_MODULE) continue
        for (const text of literalTexts(file)) {
          if (SERVER_ROUTE_PREFIX.test(text)) offenders.push(`${file}: "${text}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test("every inventory entry is used by some source file, so a route the client stopped calling leaves the inventory", () => {
    const sources = ROUTE_ROOTS.flatMap((root) => sourceFiles(root)).filter((file) => file !== INVENTORY_MODULE)
    const text = sources.map((file) => readFileSync(join(ROOT, file), "utf8")).join("\n")
    const unused = Object.keys(HTTP_ROUTES).filter((key) => !text.includes(`HTTP_ROUTES.${key}`))
    expect(unused).toEqual([])
  })

  test("the inventory has one entry per route path", () => {
    const paths = listHttpRoutes().map((route) => route.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  test("the scan covers real client sources", () => {
    const files = sourceFiles("src/client").map((file) => relative("src/client", file))
    expect(files).toContain("api/auth.ts")
  })
})
