import { describe, expect, test } from "bun:test"
import ts from "typescript"
import { findComments, isDirectiveComment, stripComments } from "./comment-scan"

function parses(fileName: string, text: string): boolean {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind)
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics
  return (diagnostics?.length ?? 0) === 0
}

describe("stripComments removes prose", () => {
  test("drops a whole-line comment along with its line", () => {
    const input = ["const a = 1", "// explains a", "const b = 2", ""].join("\n")
    expect(stripComments("x.ts", input)).toBe(["const a = 1", "const b = 2", ""].join("\n"))
  })

  test("drops a trailing comment and the whitespace before it", () => {
    expect(stripComments("x.ts", "const a = 1 // why\n")).toBe("const a = 1\n")
  })

  test("drops a multi-line JSDoc block", () => {
    const input = ["/**", " * Does a thing.", " */", "export const a = 1", ""].join("\n")
    expect(stripComments("x.ts", input)).toBe("export const a = 1\n")
  })
})

describe("stripComments never touches non-comments", () => {
  test("leaves a URL inside a string literal alone", () => {
    const input = 'const u = "https://example.com/a//b"\n'
    expect(stripComments("x.ts", input)).toBe(input)
  })

  test("leaves comment-shaped text inside a template literal alone", () => {
    const input = "const t = `line\n// not a comment\n/* nor this */`\n"
    expect(stripComments("x.ts", input)).toBe(input)
  })

  test("leaves a division expression alone", () => {
    const input = "const r = a / b / c\n"
    expect(stripComments("x.ts", input)).toBe(input)
  })

  test("keeps a shebang on line 1", () => {
    const input = "#!/usr/bin/env bun\nconst a = 1\n"
    expect(stripComments("x.ts", input)).toBe(input)
  })
})

describe("directives survive", () => {
  const kept = [
    "// eslint-disable-next-line react-hooks/refs",
    "/* eslint-disable react-hooks/refs */",
    '/// <reference types="vite/client" />',
    "/* @vite-ignore */",
    "// @ts-expect-error deliberate",
    "/* webpackChunkName: \"x\" */",
    "// prettier-ignore",
    "/* @license MIT */",
  ]

  for (const raw of kept) {
    test(`isDirectiveComment keeps ${raw}`, () => {
      expect(isDirectiveComment(raw)).toBe(true)
    })
  }

  test("a plain comment is not a directive", () => {
    expect(isDirectiveComment("// this explains the code")).toBe(false)
  })

  test("stripComments preserves an inline vite-ignore", () => {
    const input = "const m = await import(/* @vite-ignore */ url)\n"
    expect(stripComments("x.ts", input)).toBe(input)
  })

  test("findComments does not report a directive", () => {
    const input = "// eslint-disable-next-line no-console\nconsole.log(1)\n"
    expect(findComments("x.ts", input)).toHaveLength(0)
  })
})

describe("JSX comment containers", () => {
  test("removes the whole container, not just the comment", () => {
    const input = [
      "export const A = () => (",
      "  <div>",
      "    {/* explains the row */}",
      "    <span />",
      "  </div>",
      ")",
      "",
    ].join("\n")
    const out = stripComments("A.tsx", input)
    expect(out).not.toContain("{}")
    expect(out).not.toContain("explains the row")
    expect(out).toContain("<span />")
    expect(parses("A.tsx", out)).toBe(true)
  })

  test("removes a multi-line container", () => {
    const input = [
      "export const A = () => (",
      "  <div>",
      "    {/*",
      "      a long note",
      "    */}",
      "    <span />",
      "  </div>",
      ")",
      "",
    ].join("\n")
    const out = stripComments("A.tsx", input)
    expect(out).not.toContain("a long note")
    expect(parses("A.tsx", out)).toBe(true)
  })
})

describe("findComments and stripComments agree", () => {
  test("stripped output has no remaining comments", () => {
    const input = [
      "// header",
      "import x from 'y' // side note",
      "/** doc */",
      "export function f() {",
      "  /* inner */",
      "  return x",
      "}",
      "",
    ].join("\n")
    const out = stripComments("x.ts", input)
    expect(findComments("x.ts", out)).toHaveLength(0)
    expect(parses("x.ts", out)).toBe(true)
    expect(out).toContain("return x")
  })
})
