import { gunzipSync } from "node:zlib"

const BLOCK = 512
const NAME_END = 100
const SIZE_START = 124
const SIZE_END = 136
const TYPE_AT = 156
const PREFIX_START = 345
const PREFIX_END = 500

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end))
}

function isBlank(block: Uint8Array): boolean {
  return block.every((byte) => byte === 0)
}

export function extractTarGzFile(archive: Uint8Array, wanted: (path: string) => boolean): Uint8Array | null {
  const tar = gunzipSync(archive)
  let offset = 0
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (isBlank(header)) return null
    const prefix = cString(header.subarray(PREFIX_START, PREFIX_END))
    const name = cString(header.subarray(0, NAME_END))
    const path = prefix.length > 0 ? `${prefix}/${name}` : name
    const size = Number.parseInt(cString(header.subarray(SIZE_START, SIZE_END)).trim() || "0", 8)
    const type = header[TYPE_AT]
    const isFile = type === 0 || type === 0x30
    const start = offset + BLOCK
    if (isFile && wanted(path)) return Uint8Array.from(tar.subarray(start, start + size))
    offset = start + Math.ceil(size / BLOCK) * BLOCK
  }
  return null
}
