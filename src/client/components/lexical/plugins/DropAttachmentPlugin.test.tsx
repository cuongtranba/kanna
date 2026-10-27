import { describe, expect, it } from "bun:test"
import { getDroppedFiles } from "./DropAttachmentPlugin"


function makeDragEvent(files: File[]): DragEvent {
  const itemObjs = files.map((file) => ({
    kind: "file" as const,
    type: file.type,
    getAsFile: () => file,
  }))

  const itemsList: Record<string | number, unknown> = { length: itemObjs.length }
  for (let i = 0; i < itemObjs.length; i++) {
    itemsList[i] = itemObjs[i]
  }

  return {
    dataTransfer: {
      items: itemsList,
      files: null,
    },
    preventDefault: () => {},
  } as unknown as DragEvent
}


describe("getDroppedFiles", () => {
  it("extracts files from dataTransfer.items", () => {
    const file = new File(["data"], "test.pdf", { type: "application/pdf" })
    const event = makeDragEvent([file])
    const result = getDroppedFiles(event)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("test.pdf")
  })

  it("returns empty array when no files in drop", () => {
    const event = {
      dataTransfer: {
        items: { length: 0 },
        files: null,
      },
      preventDefault: () => {},
    } as unknown as DragEvent
    expect(getDroppedFiles(event)).toHaveLength(0)
  })

  it("returns empty array when dataTransfer is null", () => {
    const event = { dataTransfer: null, preventDefault: () => {} } as unknown as DragEvent
    expect(getDroppedFiles(event)).toHaveLength(0)
  })

  it("extracts multiple files from drop", () => {
    const files = [
      new File(["a"], "a.txt", { type: "text/plain" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
      new File(["c"], "c.png", { type: "image/png" }),
    ]
    const event = makeDragEvent(files)
    const result = getDroppedFiles(event)
    expect(result).toHaveLength(3)
    expect(result.map((f) => f.name)).toContain("a.txt")
    expect(result.map((f) => f.name)).toContain("b.pdf")
    expect(result.map((f) => f.name)).toContain("c.png")
  })

  it("falls back to dataTransfer.files when items is absent", () => {
    const file = new File(["x"], "fallback.txt", { type: "text/plain" })
    const fileList = {
      length: 1,
      0: file,
    }
    const event = {
      dataTransfer: {
        items: undefined,
        files: fileList,
      },
      preventDefault: () => {},
    } as unknown as DragEvent
    const result = getDroppedFiles(event)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("fallback.txt")
  })
})
