#!/usr/bin/env bun
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildWikiPages, WIKI_ROOT } from './github-wiki/build'

const target = process.argv[2]
if (!target) {
  console.error('usage: bun run scripts/export-github-wiki.ts <outDir>')
  process.exit(1)
}

const outDir = path.resolve(target)
const repoRoot = path.resolve(WIKI_ROOT, '..')
if (repoRoot === outDir || repoRoot.startsWith(outDir + path.sep)) {
  console.error(`refusing to wipe ${outDir}: it contains this repository`)
  process.exit(1)
}

const pages = await buildWikiPages()

await mkdir(outDir, { recursive: true })
for (const entry of await readdir(outDir)) {
  if (entry !== '.git') await rm(path.join(outDir, entry), { recursive: true, force: true })
}
for (const [name, content] of pages) await writeFile(path.join(outDir, name), content)
for (const assets of ['screenshots', 'diagrams']) {
  await cp(path.join(WIKI_ROOT, 'public', assets), path.join(outDir, assets), { recursive: true })
}

console.log(`Wrote ${pages.size} pages and the screenshots and diagrams to ${outDir}`)
