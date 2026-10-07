import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"
import { fileTypeFromBuffer } from "file-type"
import { isErrnoException } from "../shared/errors"
import type { UploadedAttachment } from "../shared/types"
import { getProjectUploadDir } from "./paths"

const DEFAULT_BINARY_MIME_TYPE = "application/octet-stream"
const IMAGE_MIME_PREFIX = "image/"
const FALLBACK_UPLOAD_NAME = "upload"

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

  return {
    id: randomUUID(),
    kind: mimeType.startsWith(IMAGE_MIME_PREFIX) ? "image" : "file",
    displayName: args.fileName,
    absolutePath: stored.absolutePath,
    relativePath: `./.kanna/uploads/${stored.storedName}`,
    contentUrl: `/api/projects/${args.projectId}/uploads/${encodeURIComponent(stored.storedName)}/content`,
    mimeType,
    size: args.bytes.byteLength,
    ...(stored.reused ? { reused: true } : {}),
  }
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
