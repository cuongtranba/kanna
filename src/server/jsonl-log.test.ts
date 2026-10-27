import { describe, expect, test } from "vite-plus/test"
import { readJsonl, readJsonlSkippingCorrupt, writeJsonl } from "./jsonl-log"
import { InMemoryStorageBackend } from "./storage/in-memory-storage"

const FILE = "/data/log.jsonl"

async function storageWith(text: string): Promise<InMemoryStorageBackend> {
  const storage = new InMemoryStorageBackend()
  await storage.writeText(FILE, text)
  return storage
}

describe("readJsonl", () => {
  test("returns nothing for a missing or blank file", async () => {
    expect(await readJsonl(new InMemoryStorageBackend(), FILE)).toEqual({ records: [], corruptions: [] })
    expect(await readJsonl(await storageWith("\n  \n"), FILE)).toEqual({ records: [], corruptions: [] })
  })

  test("returns each record with its zero-based line index, skipping blank lines", async () => {
    const storage = await storageWith('{"a":1}\n\n{"a":2}\n')

    const { records, corruptions } = await readJsonl<{ a: number }>(storage, FILE)

    expect(records).toEqual([{ value: { a: 1 }, lineIndex: 0 }, { value: { a: 2 }, lineIndex: 2 }])
    expect(corruptions).toEqual([])
  })

  test("flags a torn last line as trailing", async () => {
    const storage = await storageWith('{"a":1}\n{"a":2\n')

    const { records, corruptions } = await readJsonl(storage, FILE)

    expect(records).toHaveLength(1)
    expect(corruptions).toHaveLength(1)
    expect(corruptions[0]?.trailing).toBe(true)
    expect(corruptions[0]?.lineIndex).toBe(1)
  })

  test("flags a corrupt line followed by a valid one as not trailing", async () => {
    const storage = await storageWith('{"a":1}\nnot json\n{"a":3}\n')

    const { records, corruptions } = await readJsonl(storage, FILE)

    expect(records).toHaveLength(2)
    expect(corruptions[0]?.trailing).toBe(false)
  })
})

describe("readJsonl null lines", () => {
  test("a literal null line is a corruption, not a record", async () => {
    const mid = await readJsonl(await storageWith('{"a":1}\nnull\n{"a":3}\n'), FILE)
    expect(mid.records).toHaveLength(2)
    expect(mid.corruptions).toEqual([expect.objectContaining({ lineIndex: 1, trailing: false })])

    const trailing = await readJsonl(await storageWith('{"a":1}\nnull\n'), FILE)
    expect(trailing.records).toHaveLength(1)
    expect(trailing.corruptions).toEqual([expect.objectContaining({ lineIndex: 1, trailing: true })])
  })
})

describe("readJsonlSkippingCorrupt", () => {
  test("keeps every parsable record and drops every malformed line", async () => {
    const storage = await storageWith('{"a":1}\nnope\n{"a":3}\n{bad\n')

    expect(await readJsonlSkippingCorrupt(storage, FILE)).toEqual([{ a: 1 }, { a: 3 }])
  })
})

describe("writeJsonl", () => {
  test("writes one line per record and round-trips through readJsonl", async () => {
    const storage = new InMemoryStorageBackend()
    await writeJsonl(storage, FILE, [{ a: 1 }, { a: 2 }])

    expect(await storage.readText(FILE)).toBe('{"a":1}\n{"a":2}\n')
    expect((await readJsonl(storage, FILE)).records.map((record) => record.value)).toEqual([{ a: 1 }, { a: 2 }])
  })

  test("writes an empty file for no records", async () => {
    const storage = new InMemoryStorageBackend()
    await writeJsonl(storage, FILE, [])

    expect(await storage.readText(FILE)).toBe("")
  })
})
