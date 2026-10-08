import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { copyFile, link, mkdir, open, readFile, rm, stat } from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import path from "node:path"
import { fileTypeFromBuffer } from "file-type"
import { isErrnoException } from "../shared/errors"
import type { UploadedAttachment } from "../shared/types"
import { getProjectUploadDir } from "./paths"

const DEFAULT_BINARY_MIME_TYPE = "application/octet-stream"
const IMAGE_MIME_PREFIX = "image/"
const FALLBACK_UPLOAD_NAME = "upload"
const MIME_SNIFF_BYTES = 4100
const COMPARE_CHUNK_BYTES = 1024 * 1024

function foldToAscii(value: string) {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D")
}

function cleanSegment(value: string) {
  return foldToAscii(value).replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "")
}

function isOnlyDots(value: string) {
  return /^\.*$/.test(value)
}

function getUploadCandidateNames(originalName: string) {
  const parsed = path.parse(path.basename(originalName).trim())
  const cleanedName = cleanSegment(parsed.name)
  const cleanedExtension = cleanSegment(parsed.ext)
  const name = isOnlyDots(cleanedName) ? FALLBACK_UPLOAD_NAME : cleanedName
  const extension = isOnlyDots(cleanedExtension) ? "" : cleanedExtension

  return {
    first: `${name}${extension}`,
    withCounter(counter: number) {
      return `${name}-${counter}${extension}`
    },
  }
}

async function holdsSameBytes(absolutePath: string, bytes: Uint8Array): Promise<boolean> {
  try {
    const info = await stat(absolutePath)
    if (!info.isFile() || info.size !== bytes.byteLength) return false
    const existing = await readFile(absolutePath)
    return existing.equals(bytes)
  } catch {
    return false
  }
}

async function writeNewFile(absolutePath: string, bytes: Uint8Array): Promise<"written" | "exists"> {
  try {
    const handle = await open(absolutePath, "wx")
    try {
      await handle.writeFile(bytes)
    } finally {
      await handle.close()
    }
    return "written"
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") return "exists"
    throw error
  }
}

async function storeUploadBytes(uploadDir: string, fileName: string, bytes: Uint8Array) {
  const candidates = getUploadCandidateNames(fileName)
  let storedName = candidates.first
  let counter = 1

  while (true) {
    const absolutePath = path.join(uploadDir, storedName)
    if ((await writeNewFile(absolutePath, bytes)) === "written") {
      return { storedName, absolutePath, reused: false }
    }
    if (await holdsSameBytes(absolutePath, bytes)) {
      return { storedName, absolutePath, reused: true }
    }
    storedName = candidates.withCounter(counter)
    counter += 1
  }
}

interface StoredUpload {
  storedName: string
  absolutePath: string
  reused: boolean
}

function buildUploadedAttachment(args: {
  projectId: string
  fileName: string
  mimeType: string
  size: number
  stored: StoredUpload
}): UploadedAttachment {
  return {
    id: randomUUID(),
    kind: args.mimeType.startsWith(IMAGE_MIME_PREFIX) ? "image" : "file",
    displayName: args.fileName,
    absolutePath: args.stored.absolutePath,
    relativePath: `./.kanna/uploads/${args.stored.storedName}`,
    contentUrl: `/api/projects/${args.projectId}/uploads/${encodeURIComponent(args.stored.storedName)}/content`,
    mimeType: args.mimeType,
    size: args.size,
    ...(args.stored.reused ? { reused: true } : {}),
  }
}

export async function persistProjectUpload(args: {
  projectId: string
  localPath: string
  fileName: string
  bytes: Uint8Array
  fallbackMimeType?: string
}): Promise<UploadedAttachment> {
  const uploadDir = getProjectUploadDir(args.localPath)
  await mkdir(uploadDir, { recursive: true })

  const detectedType = await fileTypeFromBuffer(args.bytes)
  const mimeType = detectedType?.mime ?? args.fallbackMimeType ?? DEFAULT_BINARY_MIME_TYPE
  const stored = await storeUploadBytes(uploadDir, args.fileName, args.bytes)

  return buildUploadedAttachment({
    projectId: args.projectId,
    fileName: args.fileName,
    mimeType,
    size: args.bytes.byteLength,
    stored,
  })
}

async function readChunk(handle: FileHandle, buffer: Buffer, position: number): Promise<Buffer> {
  const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position)
  return buffer.subarray(0, bytesRead)
}

async function filesHoldSameBytes(leftPath: string, rightPath: string): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([stat(leftPath), stat(rightPath)])
    if (!left.isFile() || !right.isFile() || left.size !== right.size) return false
    const leftHandle = await open(leftPath, "r")
    try {
      const rightHandle = await open(rightPath, "r")
      try {
        const leftBuffer = Buffer.allocUnsafe(COMPARE_CHUNK_BYTES)
        const rightBuffer = Buffer.allocUnsafe(COMPARE_CHUNK_BYTES)
        for (let position = 0; position < left.size; position += COMPARE_CHUNK_BYTES) {
          const leftChunk = await readChunk(leftHandle, leftBuffer, position)
          const rightChunk = await readChunk(rightHandle, rightBuffer, position)
          if (leftChunk.byteLength === 0 || !leftChunk.equals(rightChunk)) return false
        }
        return true
      } finally {
        await rightHandle.close()
      }
    } finally {
      await leftHandle.close()
    }
  } catch {
    return false
  }
}

async function linkNewFile(sourcePath: string, targetPath: string): Promise<"linked" | "exists"> {
  try {
    await link(sourcePath, targetPath)
    return "linked"
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") return "exists"
    if (!isErrnoException(error) || error.code !== "EXDEV") throw error
  }
  try {
    await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL)
    return "linked"
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") return "exists"
    throw error
  }
}

async function storeUploadFile(uploadDir: string, fileName: string, sourcePath: string): Promise<StoredUpload> {
  const candidates = getUploadCandidateNames(fileName)
  let storedName = candidates.first
  let counter = 1

  while (true) {
    const absolutePath = path.join(uploadDir, storedName)
    if ((await linkNewFile(sourcePath, absolutePath)) === "linked") {
      return { storedName, absolutePath, reused: false }
    }
    if (await filesHoldSameBytes(absolutePath, sourcePath)) {
      return { storedName, absolutePath, reused: true }
    }
    storedName = candidates.withCounter(counter)
    counter += 1
  }
}

async function sniffMimeType(sourcePath: string): Promise<string | undefined> {
  const handle = await open(sourcePath, "r")
  try {
    const head = await readChunk(handle, Buffer.allocUnsafe(MIME_SNIFF_BYTES), 0)
    return (await fileTypeFromBuffer(head))?.mime
  } finally {
    await handle.close()
  }
}

export async function discardPartialUpload(sourcePath: string): Promise<void> {
  await Promise.all([rm(sourcePath, { force: true }), rm(`${sourcePath}.json`, { force: true })])
}

export async function finalizeUploadFromFile(args: {
  projectId: string
  localPath: string
  sourcePath: string
  fileName: string
  fallbackMimeType?: string
}): Promise<UploadedAttachment> {
  const uploadDir = getProjectUploadDir(args.localPath)
  await mkdir(uploadDir, { recursive: true })

  const mimeType = (await sniffMimeType(args.sourcePath)) ?? args.fallbackMimeType ?? DEFAULT_BINARY_MIME_TYPE
  const { size } = await stat(args.sourcePath)
  const stored = await storeUploadFile(uploadDir, args.fileName, args.sourcePath)

  return buildUploadedAttachment({ projectId: args.projectId, fileName: args.fileName, mimeType, size, stored })
}

export async function deleteProjectUpload(args: {
  localPath: string
  storedName: string
}): Promise<boolean> {
  const storedName = args.storedName
  if (!storedName || storedName.includes("/") || storedName.includes("\\") || storedName === "." || storedName === "..") {
    return false
  }

  const absolutePath = path.join(getProjectUploadDir(args.localPath), storedName)
  try {
    await rm(absolutePath, { force: true })
    return true
  } catch {
    return false
  }
}
