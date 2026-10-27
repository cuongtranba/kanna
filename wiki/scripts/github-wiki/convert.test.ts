import { expect, test } from 'vite-plus/test'
import path from 'node:path'
import { buildWikiPages, WIKI_ROOT } from './build'
import { convertWiki } from './convert'

const FENCE = /^\s*(```|~~~)/

function outsideFences(markdown: string): string[] {
  const kept: string[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence
    else if (!inFence) kept.push(line)
  }
  return kept
}

test('every real doc converts to a GitHub wiki page with no MDX left and no dangling links', async () => {
  const pages = await buildWikiPages()
  const pageNames = new Set([...pages.keys()].map(name => name.replace(/\.md$/, '')))
  const problems: string[] = []

  for (const [name, content] of pages) {
    for (const line of outsideFences(content)) {
      if (/^import\s/.test(line) || /<(Screenshot|Diagram|Narrative|HomeHero|HomeOutro|EnvVarTable)\b/.test(line) || line.startsWith(':::')) {
        problems.push(`${name}: leftover MDX: ${line.trim()}`)
      }
      const withoutCode = line.replace(/`[^`]*`/g, '')
      for (const match of withoutCode.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1]
        if (/^(https?:|mailto:|#)/.test(target)) continue
        if (/^(screenshots|diagrams)\//.test(target)) {
          if (!(await Bun.file(path.join(WIKI_ROOT, 'public', target)).exists())) problems.push(`${name}: missing asset ${target}`)
          continue
        }
        if (!pageNames.has(target.split('#')[0])) problems.push(`${name}: link to ${target} names no generated page`)
      }
    }
  }

  expect(problems).toEqual([])
})

test('asides, anchored links and fenced MDX syntax convert without touching code', () => {
  const pages = convertWiki({
    docs: [
      {
        slug: 'index',
        file: 'fixture/index.mdx',
        source: '---\ntitle: Home\ndescription: The *lead* line.\n---\n\nSee the [fixtures](/features/target/#deep-dive).\n',
      },
      {
        slug: 'features/target',
        file: 'fixture/target.mdx',
        source: [
          '---',
          'title: Target',
          'description: A target page.',
          '---',
          '',
          "import Screenshot from '../../components/Screenshot.astro'",
          '',
          ':::caution[Mind the gap]',
          'Body with [a link](/features/target/).',
          ':::',
          '',
          '```ts',
          "import { keep } from './kept'",
          '```',
          '',
        ].join('\n'),
      },
    ],
    envVars: [],
    sidebar: [{ label: 'Features', items: [{ label: 'Target', slug: 'features/target' }] }],
  })

  expect(pages.get('Home.md')).toBe('*The \\*lead\\* line.*\n\nSee the [fixtures](Features-Target#deep-dive).\n')
  expect(pages.get('Features-Target.md')).toBe(
    [
      '*A target page.*',
      '',
      '> [!CAUTION]',
      '> **Mind the gap**',
      '>',
      '> Body with [a link](Features-Target).',
      '',
      '```ts',
      "import { keep } from './kept'",
      '```',
      '',
    ].join('\n'),
  )
  expect(pages.get('_Sidebar.md')).toContain('- [Target](Features-Target)')
})
