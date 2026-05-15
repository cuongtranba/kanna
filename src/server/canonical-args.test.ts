import { test, expect } from "bun:test"
import { canonicalArgsHash } from "./canonical-args"

test("canonicalArgsHash: object key order doesn't matter", () => {
  expect(canonicalArgsHash({ a: 1, b: 2 })).toBe(canonicalArgsHash({ b: 2, a: 1 }))
})

test("canonicalArgsHash: distinguishes value differences", () => {
  expect(canonicalArgsHash({ a: 1 })).not.toBe(canonicalArgsHash({ a: 2 }))
})

test("canonicalArgsHash: handles nested structures and arrays", () => {
  const h1 = canonicalArgsHash({ x: { a: 1, b: [3, 2, 1] } })
  const h2 = canonicalArgsHash({ x: { b: [3, 2, 1], a: 1 } })
  expect(h1).toBe(h2)
})

test("canonicalArgsHash: returns 64-char hex (sha256)", () => {
  expect(canonicalArgsHash({})).toMatch(/^[0-9a-f]{64}$/)
})
