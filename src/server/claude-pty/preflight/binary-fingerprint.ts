import { createHash } from "node:crypto"
import { open } from "node:fs/promises"

export async function computeBinarySha256(filePath: string): Promise<string> {
  const fd = await open(filePath, "r")
  try {
    const hash = createHash("sha256")
    const buf = Buffer.alloc(64 * 1024)
    let pos = 0
    while (true) {
      const { bytesRead } = await fd.read(buf, 0, buf.length, pos)
      if (bytesRead === 0) break
      hash.update(buf.subarray(0, bytesRead))
      pos += bytesRead
    }
    return hash.digest("hex")
  } finally {
    await fd.close()
  }
}
