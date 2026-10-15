export interface DocSource {
  slug: string
  file: string
  source: string
}

export interface EnvVar {
  name: string
  default: string
  description: string
}

export type SidebarItem =
  | { label: string; slug: string }
  | { label: string; items: SidebarItem[] }
  | { autogenerate: { directory: string } }

export interface WikiInput {
  docs: DocSource[]
  envVars: EnvVar[]
  sidebar: SidebarItem[]
}

export const REPO_URL = 'https://github.com/cuongtranba/kanna'
export const SITE_URL = 'https://kanna-wiki.lowbit.link'
export const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`

type AttrValue = string | true | { expression: string }

interface ParsedDoc {
  slug: string
  file: string
  pageName: string
  title: string
  description: string
  body: string[]
  bodyFirstLine: number
}

interface Context {
  file: string
  envVars: EnvVar[]
  resolveHref: (href: string, where: string) => string
}

interface Fence {
  marker: string
  length: number
}

interface Tag {
  name: string
  attrs: Map<string, AttrValue>
  selfClosing: boolean
  lastLine: number
}

const ALERTS: Record<string, string> = {
  note: 'NOTE',
  tip: 'TIP',
  caution: 'CAUTION',
  danger: 'WARNING',
}

const IMPORT_LINE = /^import\s.+\sfrom\s+['"][^'"]+['"]\s*;?\s*$/
const ASIDE_OPEN = /^:::(\w+)(?:\[(.*)\])?\s*$/
const ASIDE_CLOSE = /^:::\s*$/
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/
const COMPONENT_START = /^\s*<[A-Z]/
const COMPONENT_END = /^\s*<\/[A-Z]/

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

export function pageNameFromSlug(slug: string): string {
  if (slug === 'index') return 'Home'
  return slug
    .split('/')
    .map(segment => segment.split('-').map(capitalise).join('-'))
    .join('-')
}

function fail(file: string, line: number, message: string): never {
  throw new Error(`${file}:${line}: ${message}`)
}

function parseDoc(doc: DocSource): ParsedDoc {
  const lines = doc.source.split('\n')
  const fields = new Map<string, string>()
  let bodyStart = 0
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (close === -1) fail(doc.file, 1, 'frontmatter is not closed')
    for (const line of lines.slice(1, close)) {
      const match = /^(\w+):\s*(.*?)\s*$/.exec(line)
      if (match) fields.set(match[1], match[2].replace(/^(['"])(.*)\1$/, '$2'))
    }
    bodyStart = close + 1
  }
  return {
    slug: doc.slug,
    file: doc.file,
    pageName: pageNameFromSlug(doc.slug),
    title: fields.get('title') ?? doc.slug,
    description: fields.get('description') ?? '',
    body: lines.slice(bodyStart),
    bodyFirstLine: bodyStart + 1,
  }
}

function makeResolver(slugs: Set<string>): (href: string, where: string) => string {
  return (href, where) => {
    if (!href.startsWith('/') || href.startsWith('//')) return href
    const hashAt = href.indexOf('#')
    const anchor = hashAt === -1 ? '' : href.slice(hashAt + 1)
    const path = (hashAt === -1 ? href : href.slice(0, hashAt)).replace(/^\/+|\/+$/g, '')
    if (path === 'changelog') return CHANGELOG_URL
    const slug = path === '' ? 'index' : path
    if (!slugs.has(slug)) throw new Error(`${where}: internal link ${href} does not resolve to a doc`)
    return pageNameFromSlug(slug) + (anchor ? `#${anchor}` : '')
  }
}

const CODE_SPAN = /(``.+?``|`[^`]+`)/

function rewriteLinks(line: string, ctx: Context, lineNo: number): string {
  const where = `${ctx.file}:${lineNo}`
  return line
    .split(CODE_SPAN)
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      const rewritten = segment.replace(/\]\((\/[^)\s]*)\)/g, (_, href: string) => `](${ctx.resolveHref(href, where)})`)
      if (/\]\(\//.test(rewritten)) throw new Error(`${where}: unsupported internal link syntax: ${rewritten.trim()}`)
      return rewritten
    })
    .join('')
}

function opensFence(line: string): Fence | null {
  const match = FENCE_OPEN.exec(line)
  if (!match) return null
  return { marker: match[1][0], length: match[1].length }
}

function closesFence(line: string, fence: Fence): boolean {
  const match = /^\s*(`{3,}|~{3,})\s*$/.exec(line)
  return match !== null && match[1][0] === fence.marker && match[1].length >= fence.length
}

function readTag(lines: string[], start: number, ctx: Context, firstLine: number): Tag {
  const tagLine = firstLine + start
  let text = ''
  for (let index = start; index < lines.length; index++) {
    text += (index === start ? '' : '\n') + lines[index]
    let quote = ''
    let depth = 0
    for (let at = 0; at < text.length; at++) {
      const char = text[at]
      if (quote) {
        if (char === quote) quote = ''
      } else if (char === '"') quote = char
      else if (char === '{') depth++
      else if (char === '}') depth--
      else if (char === '>' && depth === 0) {
        const rest = text.slice(at + 1).trim()
        if (rest) fail(ctx.file, tagLine, `unexpected content after a tag: ${rest}`)
        const head = text.slice(text.indexOf('<') + 1, at)
        const selfClosing = head.endsWith('/')
        const inner = selfClosing ? head.slice(0, -1) : head
        const name = /^[A-Za-z][\w.]*/.exec(inner)?.[0]
        if (!name) fail(ctx.file, tagLine, 'cannot read the component name')
        return { name, attrs: parseAttrs(inner.slice(name.length), ctx, tagLine), selfClosing, lastLine: index }
      }
    }
  }
  return fail(ctx.file, tagLine, 'component tag is never closed')
}

function parseAttrs(text: string, ctx: Context, lineNo: number): Map<string, AttrValue> {
  const attrs = new Map<string, AttrValue>()
  const pattern = /([A-Za-z][\w-]*)(?:\s*=\s*(?:"([^"]*)"|\{([^}]*)\}))?/g
  let consumed = 0
  for (const match of text.matchAll(pattern)) {
    const gap = text.slice(consumed, match.index)
    if (gap.trim()) fail(ctx.file, lineNo, `cannot read component attributes near: ${gap.trim()}`)
    consumed = match.index + match[0].length
    if (match[2] !== undefined) attrs.set(match[1], match[2])
    else if (match[3] !== undefined) attrs.set(match[1], { expression: match[3].trim() })
    else attrs.set(match[1], true)
  }
  if (text.slice(consumed).trim()) fail(ctx.file, lineNo, `cannot read component attributes near: ${text.slice(consumed).trim()}`)
  return attrs
}

function stringAttr(tag: Tag, name: string, ctx: Context, lineNo: number): string {
  const value = tag.attrs.get(name)
  if (typeof value !== 'string') fail(ctx.file, lineNo, `<${tag.name}> needs a string ${name}="…" attribute`)
  return value
}

function optionalStringAttr(tag: Tag, name: string, ctx: Context, lineNo: number): string | undefined {
  return tag.attrs.has(name) ? stringAttr(tag, name, ctx, lineNo) : undefined
}

function assetPath(path: string, ctx: Context, lineNo: number): string {
  if (!/^\/(screenshots|diagrams)\//.test(path)) fail(ctx.file, lineNo, `asset ${path} is not under /screenshots or /diagrams`)
  return path.slice(1)
}

function image(alt: string, target: string): string {
  return `![${alt.replace(/([[\]])/g, '\\$1')}](${target})`
}

function escapeCell(text: string): string {
  return text
    .split(CODE_SPAN)
    .map((segment, index) => {
      const piped = segment.replace(/\|/g, '\\|')
      return index % 2 === 1 ? piped : piped.replace(/</g, '&lt;')
    })
    .join('')
    .replace(/\s*\n\s*/g, ' ')
}

function escapeEmphasis(text: string): string {
  return text
    .split(CODE_SPAN)
    .map((segment, index) => (index % 2 === 1 ? segment : segment.replace(/\*/g, '\\*')))
    .join('')
}

function envVarTable(envVars: EnvVar[]): string[] {
  const rows = envVars.map(v => `| \`${escapeCell(v.name)}\` | \`${escapeCell(v.default)}\` | ${escapeCell(v.description)} |`)
  return ['| Variable | Default | Description |', '| --- | --- | --- |', ...rows]
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter(line => line.trim()).map(line => /^\s*/.exec(line)?.[0].length ?? 0)
  const strip = indents.length ? Math.min(...indents) : 0
  return lines.map(line => line.slice(strip))
}

function trimBlank(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].trim()) start++
  while (end > start && !lines[end - 1].trim()) end--
  return lines.slice(start, end)
}

function renderComponent(tag: Tag, lines: string[], lineNo: number, ctx: Context): { out: string[]; lastLine: number } {
  switch (tag.name) {
    case 'Screenshot': {
      const alt = stringAttr(tag, 'alt', ctx, lineNo)
      return { out: [image(alt, assetPath(stringAttr(tag, 'light', ctx, lineNo), ctx, lineNo))], lastLine: tag.lastLine }
    }
    case 'Diagram': {
      const alt = stringAttr(tag, 'alt', ctx, lineNo)
      return { out: [image(alt, `diagrams/${stringAttr(tag, 'name', ctx, lineNo)}.svg`)], lastLine: tag.lastLine }
    }
    case 'EnvVarTable': {
      const vars = tag.attrs.get('vars')
      if (typeof vars !== 'object' || vars.expression !== 'envVars') fail(ctx.file, lineNo, '<EnvVarTable> must be given vars={envVars}')
      return { out: envVarTable(ctx.envVars), lastLine: tag.lastLine }
    }
    case 'HomeOutro':
      return { out: [], lastLine: tag.lastLine }
    case 'HomeHero': {
      const hero = ['title', 'lede', 'install', 'primaryHref', 'secondaryHref', 'screenshotLight', 'screenshotAlt']
        .map(name => stringAttr(tag, name, ctx, lineNo))
      const [title, lede, install, primaryHref, secondaryHref, light, alt] = hero
      const links = `[Install guide](${ctx.resolveHref(primaryHref, `${ctx.file}:${lineNo}`)}) · [View on GitHub](${secondaryHref})`
      return {
        out: [`## ${title}`, '', lede, '', '```bash', install, '```', '', links, '', image(alt, assetPath(light, ctx, lineNo))],
        lastLine: tag.lastLine,
      }
    }
    case 'Narrative': {
      if (tag.selfClosing) fail(ctx.file, lineNo, '<Narrative> must wrap its text')
      const close = lines.findIndex((line, index) => index > tag.lastLine && /^\s*<\/Narrative>\s*$/.test(line))
      if (close === -1) fail(ctx.file, lineNo, '<Narrative> is never closed')
      const out = [`## ${stringAttr(tag, 'title', ctx, lineNo)}`, '']
      const light = optionalStringAttr(tag, 'screenshotLight', ctx, lineNo)
      if (light) out.push(image(optionalStringAttr(tag, 'screenshotAlt', ctx, lineNo) ?? '', assetPath(light, ctx, lineNo)), '')
      const children = dedent(lines.slice(tag.lastLine + 1, close))
      out.push(...convertLines(trimBlank(children), ctx, tag.lastLine + 2))
      return { out, lastLine: close }
    }
    default:
      return fail(ctx.file, lineNo, `unsupported component <${tag.name}>; add a rule to wiki/scripts/github-wiki/convert.ts`)
  }
}

function findAsideClose(lines: string[], start: number, file: string): number {
  let fence: Fence | null = null
  for (let index = start + 1; index < lines.length; index++) {
    if (fence) {
      if (closesFence(lines[index], fence)) fence = null
    } else if (ASIDE_CLOSE.test(lines[index])) return index
    else fence = opensFence(lines[index])
  }
  return fail(file, start + 1, 'aside is never closed')
}

function convertLines(lines: string[], ctx: Context, firstLine: number): string[] {
  const out: string[] = []
  let fence: Fence | null = null
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const lineNo = firstLine + index
    if (fence) {
      out.push(line)
      if (closesFence(line, fence)) fence = null
      index++
      continue
    }
    const opened = opensFence(line)
    if (opened) {
      fence = opened
      out.push(line)
      index++
      continue
    }
    if (IMPORT_LINE.test(line)) {
      index++
      while (index < lines.length && !lines[index].trim() && (out.length === 0 || !out[out.length - 1].trim())) index++
      continue
    }
    const aside = ASIDE_OPEN.exec(line)
    if (aside) {
      const alert = ALERTS[aside[1]]
      if (!alert) fail(ctx.file, lineNo, `unsupported aside type :::${aside[1]}`)
      const close = findAsideClose(lines, index, ctx.file)
      const body = trimBlank(convertLines(lines.slice(index + 1, close), ctx, lineNo + 1))
      out.push(`> [!${alert}]`)
      if (aside[2]) out.push(`> **${aside[2]}**`, '>')
      for (const bodyLine of body) out.push(bodyLine ? `> ${bodyLine}` : '>')
      if (close + 1 < lines.length && lines[close + 1].trim()) out.push('')
      index = close + 1
      continue
    }
    if (COMPONENT_START.test(line)) {
      const tag = readTag(lines, index, ctx, firstLine)
      const rendered = renderComponent(tag, lines, lineNo, ctx)
      out.push(...rendered.out)
      index = rendered.lastLine + 1
      continue
    }
    if (COMPONENT_END.test(line)) fail(ctx.file, lineNo, `stray closing tag: ${line.trim()}`)
    out.push(rewriteLinks(line, ctx, lineNo))
    index++
  }
  return out
}

function convertDoc(doc: ParsedDoc, envVars: EnvVar[], resolveHref: Context['resolveHref']): string {
  const ctx: Context = { file: doc.file, envVars, resolveHref }
  const body = trimBlank(convertLines(doc.body, ctx, doc.bodyFirstLine))
  const lead = doc.description ? [`*${escapeEmphasis(doc.description)}*`, ''] : []
  return [...lead, ...body].join('\n') + '\n'
}

function renderSidebarItems(items: SidebarItem[], docs: ParsedDoc[], indent: string, file: string): string[] {
  const out: string[] = []
  for (const item of items) {
    if ('autogenerate' in item) {
      const prefix = `${item.autogenerate.directory}/`
      const children = docs
        .filter(doc => doc.slug.startsWith(prefix) && !doc.slug.slice(prefix.length).includes('/'))
        .sort((a, b) => a.file.localeCompare(b.file))
      if (!children.length) throw new Error(`${file}: autogenerate directory ${item.autogenerate.directory} has no docs`)
      for (const child of children) out.push(`${indent}- [${child.title}](${child.pageName})`)
    } else if ('items' in item) {
      out.push(`${indent}- ${item.label}`, ...renderSidebarItems(item.items, docs, `${indent}  `, file))
    } else {
      out.push(`${indent}- ${sidebarLink(item, docs, file)}`)
    }
  }
  return out
}

function sidebarLink(item: { label: string; slug: string }, docs: ParsedDoc[], file: string): string {
  if (item.slug === 'changelog') return `[${item.label}](${CHANGELOG_URL})`
  const doc = docs.find(candidate => candidate.slug === item.slug)
  if (!doc) throw new Error(`${file}: sidebar slug ${item.slug} has no doc`)
  return `[${item.label}](${doc.pageName})`
}

function buildSidebar(sidebar: SidebarItem[], docs: ParsedDoc[]): string {
  const file = 'wiki/src/sidebar.mjs'
  const lines = [`**[Home](Home)** · [Docs site ↗](${SITE_URL})`, '']
  for (const group of sidebar) {
    if ('slug' in group) lines.push(`**${sidebarLink(group, docs, file)}**`, '')
    else if ('items' in group) lines.push(`**${group.label}**`, '', ...renderSidebarItems(group.items, docs, '', file), '')
    else lines.push(...renderSidebarItems([group], docs, '', file), '')
  }
  return trimBlank(lines).join('\n') + '\n'
}

function buildFooter(): string {
  return [
    `This wiki is generated from [\`wiki/src/content/docs\`](${REPO_URL}/tree/main/wiki/src/content/docs) in [cuongtranba/kanna](${REPO_URL}).`,
    `Edit the docs there: changes made on this wiki are overwritten on the next sync.`,
    `The same docs are published at [${SITE_URL}](${SITE_URL}).`,
  ].join('\n\n') + '\n'
}

export function convertWiki(input: WikiInput): Map<string, string> {
  const docs = input.docs.map(parseDoc)
  const slugs = new Set(docs.map(doc => doc.slug))
  const resolveHref = makeResolver(slugs)
  const pages = new Map<string, string>()
  const owners = new Map<string, string>()
  for (const doc of docs) {
    const owner = owners.get(doc.pageName)
    if (owner) throw new Error(`${doc.file}: page name ${doc.pageName} is already taken by ${owner}`)
    owners.set(doc.pageName, doc.file)
    pages.set(`${doc.pageName}.md`, convertDoc(doc, input.envVars, resolveHref))
  }
  pages.set('_Sidebar.md', buildSidebar(input.sidebar, docs))
  pages.set('_Footer.md', buildFooter())
  return pages
}
