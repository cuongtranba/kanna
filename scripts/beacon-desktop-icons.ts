import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { deflateSync } from "node:zlib"
import type { MarkStroke } from "../src/client/lib/stateMark"

type Rgb = readonly [number, number, number]

const CORAL: Rgb = [255, 99, 126]
const MARGIN: Rgb = [128, 117, 118]
const PAPER: Rgb = [255, 253, 253]
const OUT_DIR = "apps/beacon-desktop/assets"
const SUPERSAMPLE = 4
const PROVENANCE =
  "Drawn procedurally by scripts/beacon-desktop-icons.ts: a beacon mast on a base with signal arcs. No image model, no external source."

interface Layer {
  color: Rgb
  coverage: (x: number, y: number) => boolean
}

function segmentDistance(px: number, py: number, stroke: MarkStroke): number {
  const dx = stroke.x2 - stroke.x1
  const dy = stroke.y2 - stroke.y1
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - stroke.x1) * dx + (py - stroke.y1) * dy) / lengthSquared))
  return Math.hypot(px - (stroke.x1 + t * dx), py - (stroke.y1 + t * dy))
}

function arcsLayer(color: Rgb, box: { x: number; y: number; scale: number; width: number }, radii: readonly number[]): Layer {
  const cx = box.x + 7 * box.scale
  const cy = box.y + 5 * box.scale
  const spread = (40 * Math.PI) / 180
  return {
    color,
    coverage: (x, y) => {
      const dx = x - cx
      const dy = y - cy
      const angle = Math.atan2(dy, Math.abs(dx))
      if (Math.abs(angle) > spread) return false
      const distance = Math.hypot(dx, dy)
      return radii.some((radius) => Math.abs(distance - radius * box.scale) <= box.width / 2)
    },
  }
}

function mastLayer(color: Rgb, box: { x: number; y: number; scale: number; width: number }): Layer {
  const at = (x: number, y: number) => ({ x: box.x + x * box.scale, y: box.y + y * box.scale })
  const top = at(7, 5)
  const bottom = at(7, 12.5)
  const left = at(4, 12.5)
  const right = at(10, 12.5)
  const strokes: MarkStroke[] = [
    { x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y },
    { x1: left.x, y1: left.y, x2: right.x, y2: right.y },
  ]
  return {
    color,
    coverage: (x, y) => strokes.some((stroke) => segmentDistance(x, y, stroke) <= box.width / 2),
  }
}

function roundedSquare(size: number, radius: number, color: Rgb): Layer {
  return {
    color,
    coverage: (x, y) => {
      const cx = Math.min(Math.max(x, radius), size - radius)
      const cy = Math.min(Math.max(y, radius), size - radius)
      return Math.hypot(x - cx, y - cy) <= radius
    },
  }
}

function render(size: number, layers: readonly Layer[]): Uint8Array {
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const layer of layers) {
        let hits = 0
        for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
          for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
            if (layer.coverage(x + (sx + 0.5) / SUPERSAMPLE, y + (sy + 0.5) / SUPERSAMPLE)) hits += 1
          }
        }
        const alpha = hits / (SUPERSAMPLE * SUPERSAMPLE)
        r = layer.color[0] * alpha + r * (1 - alpha)
        g = layer.color[1] * alpha + g * (1 - alpha)
        b = layer.color[2] * alpha + b * (1 - alpha)
        a = alpha + a * (1 - alpha)
      }
      const offset = (y * size + x) * 4
      const unpremultiply = a === 0 ? 0 : 1 / a
      pixels[offset] = Math.round(r * unpremultiply)
      pixels[offset + 1] = Math.round(g * unpremultiply)
      pixels[offset + 2] = Math.round(b * unpremultiply)
      pixels[offset + 3] = Math.round(a * 255)
    }
  }
  return pixels
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typed = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

function encodePng(size: number, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  const rows = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    rows[y * (size * 4 + 1)] = 0
    Buffer.from(pixels.subarray(y * size * 4, (y + 1) * size * 4)).copy(rows, y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.from(`impeccable:prompt\0${PROVENANCE}`, "latin1")),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", new Uint8Array()),
  ])
}

function encodeIco(images: ReadonlyArray<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

function beaconLayers(size: number, fill: number, live: boolean, color: Rgb, weight: number): Layer[] {
  const scale = (size * fill) / 14
  const box = { x: (size - 14 * scale) / 2, y: (size - 14 * scale) / 2 + scale * 0.5, scale, width: Math.max(1.5, weight * scale) }
  return live ? [mastLayer(color, box), arcsLayer(color, box, [3, 5.6])] : [mastLayer(color, box)]
}

function trayIcon(size: number, live: boolean, color: Rgb): Buffer {
  return encodePng(size, render(size, beaconLayers(size, 1, live, color, 1.5)))
}

function appIcon(size: number): Buffer {
  return encodePng(size, render(size, [roundedSquare(size, size * 0.22, PAPER), ...beaconLayers(size, 0.66, true, CORAL, 1.35)]))
}

mkdirSync(OUT_DIR, { recursive: true })
for (const [name, live, color] of [["tray-online", true, CORAL], ["tray-idle", false, MARGIN]] as const) {
  writeFileSync(join(OUT_DIR, `${name}.png`), trayIcon(32, live, color))
  writeFileSync(join(OUT_DIR, `${name}.ico`), encodeIco([16, 20, 24, 32].map((size) => ({ size, png: trayIcon(size, live, color) }))))
}
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((size) => ({ size, png: appIcon(size) }))
writeFileSync(join(OUT_DIR, "icon.png"), appIcon(512))
writeFileSync(join(OUT_DIR, "icon.ico"), encodeIco(pngs))
process.stdout.write(`beacon-desktop-icons: wrote ${OUT_DIR}\n`)
