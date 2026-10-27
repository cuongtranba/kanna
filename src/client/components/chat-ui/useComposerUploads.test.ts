import { describe, expect, test } from "vite-plus/test"
import type { UploadedAttachment } from "../../../shared/types"
import { makeFakeCommandPort } from "../../adapters/testing/makeFakePorts"
import { getClipboardImageFiles } from "../lexical/plugins/PasteImagePlugin"
import { deleteUploadedAttachment, willExceedAttachmentLimit } from "./useComposerUploads"

function createClipboardItem(args: {
  kind?: string
  type: string
  file?: File | null
}) {
  return {
    kind: args.kind ?? "file",
    type: args.type,
    getAsFile: () => args.file ?? null,
  }
}

function uploadedAttachment(storedName: string, reused?: boolean): UploadedAttachment {
  return {
    id: storedName,
    kind: "file",
    displayName: storedName,
    absolutePath: `/project/.kanna/uploads/${storedName}`,
    relativePath: `./.kanna/uploads/${storedName}`,
    contentUrl: `/api/projects/p1/uploads/${storedName}/content`,
    mimeType: "text/plain",
    size: 4,
    ...(reused ? { reused } : {}),
  }
}

describe("deleteUploadedAttachment", () => {
  test("deletes a freshly stored upload the composer drops", async () => {
    const commands = makeFakeCommandPort(() => ({ deleted: true }))

    await deleteUploadedAttachment(uploadedAttachment("fresh.txt"), commands)

    expect(commands.calls).toEqual([{ type: "upload.delete", projectId: "p1", storedName: "fresh.txt" }])
  })

  test("never deletes a reused upload, which an earlier message may still reference", async () => {
    const commands = makeFakeCommandPort(() => ({ deleted: true }))

    await deleteUploadedAttachment(uploadedAttachment("shared.txt", true), commands)

    expect(commands.calls).toEqual([])
  })
})


describe("willExceedAttachmentLimit", () => {
  test("rejects a batch that would push the composer above the total attachment limit", () => {
    expect(
      willExceedAttachmentLimit({
        currentAttachmentCount: 45,
        queuedAttachmentCount: 3,
        incomingAttachmentCount: 3,
      }),
    ).toBe(true)
  })

  test("allows a batch that exactly reaches the total attachment limit", () => {
    expect(
      willExceedAttachmentLimit({
        currentAttachmentCount: 45,
        queuedAttachmentCount: 3,
        incomingAttachmentCount: 2,
      }),
    ).toBe(false)
  })

  test("counts pasted files against the same total attachment limit", () => {
    const pastedFiles = getClipboardImageFiles(
      [
        createClipboardItem({
          type: "image/png",
          file: new File(["a"], "", { type: "image/png" }),
        }),
        createClipboardItem({
          type: "image/png",
          file: new File(["b"], "", { type: "image/png" }),
        }),
      ],
      123,
    )

    expect(
      willExceedAttachmentLimit({
        currentAttachmentCount: 48,
        queuedAttachmentCount: 0,
        incomingAttachmentCount: pastedFiles.length,
      }),
    ).toBe(false)
  })
})
