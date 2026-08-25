import { readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { join } from "node:path"

const clientDir = join(import.meta.dir, "..", "dist", "client")
const html = readFileSync(join(clientDir, "index.html"), "utf8")
const entryMatch = html.match(/src="\/assets\/([^"]+\.js)"/)

if (!entryMatch) {
  throw new Error("Client entry script was not found in dist/client/index.html")
}

const entryPath = join(clientDir, "assets", entryMatch[1])
const gzipBytes = gzipSync(readFileSync(entryPath)).byteLength
const maximumGzipBytes = 350_000

if (gzipBytes > maximumGzipBytes) {
  throw new Error(`Client entry is ${gzipBytes} gzip bytes; budget is ${maximumGzipBytes}`)
}

console.log(`Client entry: ${gzipBytes} gzip bytes (budget ${maximumGzipBytes})`)
