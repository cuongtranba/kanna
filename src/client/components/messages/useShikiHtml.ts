import { useEffect } from "react"
import { useOptionalResolvedTheme } from "../../hooks/useTheme"
import { log } from "../../../shared/log"
import { ShikiHtmlStore } from "./useShikiHtml.store"

const SHIKI_SIZE_CEILING = 200 * 1024

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  py: "python",
  python: "python",
  go: "go",
  golang: "go",
  rs: "rust",
  rust: "rust",
  java: "java",
  rb: "ruby",
  ruby: "ruby",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  shell: "bash",
  yml: "yaml",
  yaml: "yaml",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  json: "json",
  json5: "json5",
  md: "markdown",
  markdown: "markdown",
  sql: "sql",
  cpp: "cpp",
  "c++": "cpp",
  c: "c",
  h: "c",
  swift: "swift",
  kt: "kotlin",
  kotlin: "kotlin",
  php: "php",
  toml: "toml",
  dockerfile: "dockerfile",
  diff: "diff",
  patch: "diff",
  vue: "vue",
  svelte: "svelte",
}

export function resolveShikiLang(alias: string): string | null {
  return LANG_MAP[alias.toLowerCase()] ?? null
}

export function shikiLangOfFileName(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".")
  return resolveShikiLang(dot < 0 ? fileName : fileName.slice(dot + 1))
}

const PRE_OPEN = /^<pre[^>]*>/
const PRE_CLOSE = /<\/pre>\s*$/
const CODE_OPEN = /^<code[^>]*>/
const CODE_CLOSE = /<\/code>\s*$/

export function stripShikiWrappers(html: string): string {
  return html
    .replace(PRE_OPEN, "")
    .replace(PRE_CLOSE, "")
    .replace(CODE_OPEN, "")
    .replace(CODE_CLOSE, "")
}

export function useShikiHtml(source: string, lang: string | null): string | null {
  const theme = useOptionalResolvedTheme() === "dark" ? "github-dark" : "github-light"
  const shouldHighlight = lang !== null && source.length <= SHIKI_SIZE_CEILING
  const highlighted = ShikiHtmlStore.useScopedStore((s) => s.highlighted)
  const setHighlighted = ShikiHtmlStore.useScopedStore((s) => s.setHighlighted)

  useEffect(() => {
    if (!shouldHighlight || lang === null) return
    let cancelled = false
    import("shiki")
      .then(async (mod) => {
        if (cancelled) return
        const html = await mod.codeToHtml(source, { lang, theme })
        if (cancelled) return
        setHighlighted({ source, theme, lang, html })
      })
      .catch(() => {
        log.warn("[transcript] Shiki unavailable; falling back to plain code")
      })
    return () => {
      cancelled = true
    }
  }, [shouldHighlight, source, lang, theme, setHighlighted])

  const isCurrent =
    highlighted !== null &&
    highlighted.source === source &&
    highlighted.theme === theme &&
    highlighted.lang === lang
  return isCurrent ? highlighted.html : null
}
