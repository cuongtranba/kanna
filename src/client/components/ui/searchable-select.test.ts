import { expect, test } from "bun:test"
import { filterSearchableOptions, type SearchableOption } from "./searchable-select"

const OPTIONS: SearchableOption[] = [
  { value: "p1", label: "kanna", hint: "/Users/me/work/kanna" },
  { value: "p2", label: "blog", hint: "/Users/me/sites/blog" },
]

test("typing part of a project path finds the project even when its name differs", () => {
  expect(filterSearchableOptions(OPTIONS, "SITES/")).toEqual([OPTIONS[1]])
})

test("an empty query keeps every option and a label match is case-insensitive", () => {
  expect(filterSearchableOptions(OPTIONS, "  ")).toEqual(OPTIONS)
  expect(filterSearchableOptions(OPTIONS, "KAN")).toEqual([OPTIONS[0]])
})
