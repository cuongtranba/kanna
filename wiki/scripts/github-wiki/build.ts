import path from 'node:path'
import { Glob } from 'bun'
import { envVars } from '../../src/content/docs/reference/env-vars-data'
import { sidebar } from '../../src/sidebar.mjs'
import { convertWiki, type DocSource, type SidebarItem } from './convert'

export const WIKI_ROOT = path.resolve(import.meta.dirname, '../..')
export const DOCS_DIR = path.join(WIKI_ROOT, 'src/content/docs')

const GENERATED_DOCS = new Set(['changelog.md'])

async function readDocs(): Promise<DocSource[]> {
  const docs: DocSource[] = []
  for await (const relative of new Glob('**/*.{md,mdx}').scan({ cwd: DOCS_DIR })) {
    if (GENERATED_DOCS.has(relative)) continue
    docs.push({
      slug: relative.replace(/\.mdx?$/, ''),
      file: path.join('wiki/src/content/docs', relative),
      source: await Bun.file(path.join(DOCS_DIR, relative)).text(),
    })
  }
  return docs.sort((a, b) => a.slug.localeCompare(b.slug))
}

export async function buildWikiPages(): Promise<Map<string, string>> {
  const items: SidebarItem[] = sidebar
  return convertWiki({ docs: await readDocs(), envVars, sidebar: items })
}
