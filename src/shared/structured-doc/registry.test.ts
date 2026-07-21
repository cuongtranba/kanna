import { describe, expect, test } from "bun:test"

import { markdownDoc } from "./markdown"
import { resolveStructuredDoc } from "./registry"

describe("resolveStructuredDoc", () => {
  test("resolves markdown extensions (with or without dot, any case)", () => {
    expect(resolveStructuredDoc("md")).toBe(markdownDoc)
    expect(resolveStructuredDoc(".md")).toBe(markdownDoc)
    expect(resolveStructuredDoc(".MD")).toBe(markdownDoc)
    expect(resolveStructuredDoc("markdown")).toBe(markdownDoc)
  })

  test("returns null for unsupported extensions", () => {
    expect(resolveStructuredDoc("json")).toBeNull()
    expect(resolveStructuredDoc(".yaml")).toBeNull()
    expect(resolveStructuredDoc("")).toBeNull()
  })
})
