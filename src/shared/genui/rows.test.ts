import { expect, test } from "bun:test"
import { rowsFromCsv, rowsFromJson } from "./index"

test("reads a CSV whose quoted fields contain commas, quotes and line breaks", () => {
  const csv = "customer,note,revenue\r\n\"Acme, Inc.\",\"said \"\"hi\"\"\nthen left\",\"1,200\"\r\nGlobex,,5\r\n"
  expect(rowsFromCsv(csv)).toEqual({
    ok: true,
    rows: [
      { customer: "Acme, Inc.", note: "said \"hi\"\nthen left", revenue: "1,200" },
      { customer: "Globex", note: "", revenue: "5" },
    ],
  })
})

test("reads a {columns, rows} table as returned by BI tools", () => {
  const table = { columns: [{ name: "stage", type: "text" }, { name: "total", type: "numeric" }], rows: [["won", 7]] }
  expect(rowsFromJson({ result: table }, "result")).toEqual({ ok: true, rows: [{ stage: "won", total: 7 }] })
})

test("finds the table under a conventional key when no rowsPath is given", () => {
  expect(rowsFromJson({ items: [{ a: 1 }] })).toEqual({ ok: true, rows: [{ a: 1 }] })
})

test("explains what shape it expected when the data is not a table", () => {
  const parsed = rowsFromJson({ answer: 42 })
  expect(parsed.ok).toBe(false)
})
