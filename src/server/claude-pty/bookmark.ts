import { createHash } from "node:crypto"
import { open, stat } from "node:fs/promises"

export interface CompositeVersion {
  inode: number
  ctimeNs: bigint
  contentHash: string
  byteOffset: number
}

export async function computeCompositeVersion(
  filePath: string,
  byteOffset: number,
): Promise<CompositeVersion | null> {
  let statResult
  try {
    statResult = await stat(filePath, { bigint: true })
  } catch {
    return null
  }

  const hash = createHash("sha256")
  const upTo = byteOffset > 0 ? Math.min(byteOffset, Number(statResult.size)) : Number(statResult.size)
  if (upTo > 0) {
    const fd = await open(filePath, "r")
    try {
      const buf = Buffer.alloc(64 * 1024)
      let read = 0
      while (read < upTo) {
        const { bytesRead } = await fd.read(buf, 0, Math.min(buf.length, upTo - read), read)
        if (bytesRead === 0) break
        hash.update(buf.subarray(0, bytesRead))
        read += bytesRead
      }
    } finally {
      await fd.close()
    }
  }

  return {
    inode: Number(statResult.ino),
    ctimeNs: statResult.ctimeNs,
    contentHash: hash.digest("hex"),
    byteOffset: upTo,
  }
}
