import { useCallback, useEffect, useRef, type MutableRefObject } from "react"
import { SerializeAddon } from "@xterm/addon-serialize"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal, type ITheme, type ITerminalOptions } from "@xterm/xterm"
import type { TerminalSnapshot } from "../../../shared/protocol"
import type { KannaSocket, SocketStatus } from "../../app/socket"
import { useTheme } from "../../hooks/useTheme"
import { TerminalPaneStore } from "./TerminalPane.store"
import type { DomPort } from "../../ports/domPort"
import type { TimerPort } from "../../ports/timerPort"
import { domAdapter } from "../../adapters/dom.adapter"
import { timerAdapter } from "../../adapters/timer.adapter"

export interface TerminalPanePorts {
  dom?: DomPort
  timer?: TimerPort
}

interface Props {
  projectId: string
  terminalId: string
  socket: KannaSocket
  scrollback: number
  connectionStatus: SocketStatus
  clearVersion?: number
  focusRequestVersion?: number
  onPathChange?: (path: string | null) => void
  onCommandSent?: () => void
  ports?: TerminalPanePorts
}

const TERMINAL_ANSI_LIGHT = {
  black: "#0f172a",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#94a3b8",
  brightBlack: "#475569",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#e2e8f0",
} as const

const TERMINAL_ANSI_DARK = {
  black: "#0f172a",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#cbd5e1",
  brightBlack: "#64748b",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f8fafc",
} as const

function readCssVar(name: string, fallback: string, dom: DomPort): string {
  return dom.getCssVar(name, fallback)
}

function buildTerminalTheme(mode: "light" | "dark", dom: DomPort): ITheme {
  const ansi = mode === "dark" ? TERMINAL_ANSI_DARK : TERMINAL_ANSI_LIGHT
  const fg = readCssVar("--foreground", mode === "dark" ? "#f8fafc" : "#0f172a", dom)
  const bg = readCssVar("--background", mode === "dark" ? "#000000" : "#ffffff", dom)
  return {
    foreground: fg,
    background: "transparent",
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: mode === "dark" ? "rgba(248,250,252,0.28)" : "rgba(221,228,236,0.55)",
    selectionInactiveBackground: mode === "dark" ? "rgba(248,250,252,0.18)" : "rgba(221,228,236,0.38)",
    ...ansi,
  }
}

function getTerminalSize(terminal: Terminal) {
  return {
    cols: Math.max(1, terminal.cols || 80),
    rows: Math.max(1, terminal.rows || 24),
  }
}

function getMeasuredTerminalSize(terminal: Terminal, container: HTMLElement, dom: DomPort) {
  const xtermElement = terminal.element
  interface TerminalInternals {
    _core?: {
      _renderService?: {
        dimensions?: {
          css?: {
            cell?: { width?: number; height?: number }
          }
        }
      }
    }
  }
  function isTerminalInternals(t: Terminal): t is Terminal & TerminalInternals { return "_core" in t }
  const cellDimensions = isTerminalInternals(terminal)
    ? terminal._core?._renderService?.dimensions?.css?.cell
    : undefined

  const cellWidth = cellDimensions?.width ?? 0
  const cellHeight = cellDimensions?.height ?? 0

  if (!xtermElement || !Number.isFinite(cellWidth) || !Number.isFinite(cellHeight) || cellWidth <= 0 || cellHeight <= 0) {
    return null
  }

  const containerRect = container.getBoundingClientRect()
  const containerStyle = dom.getComputedStyle(container)
  const xtermStyle = dom.getComputedStyle(xtermElement)
  const overviewRulerWidth = terminal.options.scrollback === 0 ? 0 : (terminal.options.overviewRuler?.width ?? 14)
  const widthPadding = parseFloat(containerStyle.paddingLeft) + parseFloat(containerStyle.paddingRight) + parseFloat(xtermStyle.paddingLeft) + parseFloat(xtermStyle.paddingRight)
  const heightPadding = parseFloat(containerStyle.paddingTop) + parseFloat(containerStyle.paddingBottom) + parseFloat(xtermStyle.paddingTop) + parseFloat(xtermStyle.paddingBottom)
  const availableWidth = Math.max(0, containerRect.width - widthPadding - overviewRulerWidth - 1)
  const availableHeight = Math.max(0, containerRect.height - heightPadding)

  return {
    cols: Math.max(2, Math.floor(availableWidth / cellWidth)),
    rows: Math.max(1, Math.floor(availableHeight / cellHeight)),
  }
}

function refreshTerminal(terminal: Terminal) {
  terminal.refresh(0, Math.max(0, terminal.rows - 1))
}


function isMacPlatform(platform: string) {
  return /mac/i.test(platform)
}

interface MacOptionKeyEvent {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  key: string
  getModifierState?: (key: string) => boolean
}

export function getTerminalOptions(scrollback: number, theme: ITheme, platform = globalThis.navigator?.platform ?? ""): ITerminalOptions {
  return {
    scrollback,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 1,
    lineHeight: 1,
    convertEol: false,
    allowTransparency: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
    theme,
    macOptionIsMeta: isMacPlatform(platform),
  }
}

export function getMacOptionInputSequence(event: MacOptionKeyEvent, platform = globalThis.navigator?.platform ?? "") {
  if (event.ctrlKey) return null

  if (!event.altKey && !event.metaKey) {
    switch (event.key) {
      case "ArrowUp":
        return "\x1b[A"
      case "ArrowDown":
        return "\x1b[B"
      case "ArrowLeft":
        return "\x1b[D"
      case "ArrowRight":
        return "\x1b[C"
      default:
        return null
    }
  }

  if (!isMacPlatform(platform)) return null

  if (event.metaKey && !event.altKey) {
    switch (event.key) {
      case "Backspace":
        return "\x15"
      case "Delete":
        return "\x0b"
      default:
        return null
    }
  }

  const isOptionPressed = event.altKey || event.getModifierState?.("AltGraph") === true
  if (!isOptionPressed) return null

  switch (event.key) {
    case "ArrowLeft":
      return "\x1bb"
    case "ArrowRight":
      return "\x1bf"
    case "Backspace":
      return "\x1b\x7f"
    case "Delete":
      return "\x1bd"
    default:
      return null
  }
}

function syncTerminalSize(
  terminal: Terminal,
  container: HTMLElement,
  lastSizeRef: MutableRefObject<{ cols: number; rows: number } | null>,
  hasCreated: boolean,
  sendResize: (cols: number, rows: number) => void,
  dom: DomPort
) {
  const nextSize = getMeasuredTerminalSize(terminal, container, dom) ?? getTerminalSize(terminal)
  if (lastSizeRef.current && lastSizeRef.current.cols === nextSize.cols && lastSizeRef.current.rows === nextSize.rows) {
    return nextSize
  }
  terminal.resize(nextSize.cols, nextSize.rows)
  lastSizeRef.current = nextSize
  if (hasCreated) {
    sendResize(nextSize.cols, nextSize.rows)
  }
  return nextSize
}

function TerminalPaneInner({
  projectId,
  terminalId,
  socket,
  scrollback,
  connectionStatus,
  clearVersion = 0,
  focusRequestVersion = 0,
  onPathChange,
  onCommandSent,
  ports = {},
}: Props) {
  const dom = ports.dom ?? domAdapter
  const timer = ports.timer ?? timerAdapter
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const replayStateRef = useRef<string | null>(null)
  const onCommandSentRef = useRef<Props["onCommandSent"]>(onCommandSent)
  const hasCreatedRef = useRef(false)
  const createAttemptRef = useRef(0)
  const lastAppliedSnapshotKeyRef = useRef<string | null>(null)
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const metadata = TerminalPaneStore.useScopedStore((state) => state.metadata)
  const error = TerminalPaneStore.useScopedStore((state) => state.error)
  const storeSetError = TerminalPaneStore.useScopedStore((state) => state.setError)
  const setMetadataConditional = TerminalPaneStore.useScopedStore((state) => state.setMetadataConditional)
  const setMetadataFromExit = TerminalPaneStore.useScopedStore((state) => state.setMetadataFromExit)
  const resetTerminal = TerminalPaneStore.useScopedStore((state) => state.resetTerminal)
  const terminalTheme = buildTerminalTheme(resolvedTheme === "dark" ? "dark" : "light", dom)
  const sendInput = useCallback((data: string) => {
    void socket.command({
      type: "terminal.input",
      terminalId,
      data,
    }).catch((commandError) => {
      storeSetError(commandError instanceof Error ? commandError.message : String(commandError))
    })
    if (data.includes("\r") || data.includes("\n")) {
      onCommandSentRef.current?.()
    }
  }, [socket, terminalId, storeSetError])
  const sendResize = useCallback((cols: number, rows: number) => {
    void socket.command({
      type: "terminal.resize",
      terminalId,
      cols,
      rows,
    }).catch(() => {})
  }, [socket, terminalId])
  const scheduleResizeSync = useCallback(() => {
    const sync = () => {
      const terminalInstance = terminalRef.current
      const element = containerRef.current
      if (!terminalInstance || !element || !hasCreatedRef.current) return
      syncTerminalSize(terminalInstance, element, lastSizeRef, true, sendResize, dom)
    }

    timer.requestAnimationFrame(() => {
      sync()
      timer.setTimeout(sync, 0)
    })
  }, [dom, sendResize, timer])

  useEffect(() => {
    onCommandSentRef.current = onCommandSent
  }, [onCommandSent])

  useEffect(() => {
    const terminal = new Terminal(getTerminalOptions(scrollback, terminalTheme))
    const serializeAddon = new SerializeAddon()
    terminal.loadAddon(serializeAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true

      const sequence = getMacOptionInputSequence(event)
      if (!sequence) return true

      event.preventDefault()
      sendInput(sequence)
      return false
    })

    terminalRef.current = terminal

    const element = containerRef.current

    if (element) {
      terminal.open(element)
      if (replayStateRef.current) {
        terminal.write(replayStateRef.current)
      }
      syncTerminalSize(terminal, element, lastSizeRef, false, () => {}, dom)
      refreshTerminal(terminal)
      scheduleResizeSync()
    }

    const dataDisposable = terminal.onData((data) => {
      sendInput(data)
    })

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (!hasCreatedRef.current) return
      const nextSize = { cols, rows }
      if (lastSizeRef.current && lastSizeRef.current.cols === cols && lastSizeRef.current.rows === rows) {
        return
      }
      lastSizeRef.current = nextSize
      sendResize(cols, rows)
    })

    const observer = new ResizeObserver(() => {
      const terminalInstance = terminalRef.current
      const element = containerRef.current
      if (!terminalInstance || !element) return
      syncTerminalSize(terminalInstance, element, lastSizeRef, hasCreatedRef.current, (cols, rows) => {
        void socket.command({
          type: "terminal.resize",
          terminalId,
          cols,
          rows,
        }).catch(() => {})
      }, dom)
    })

    if (element) {
      observer.observe(element)
    }

    return () => {
      observer.disconnect()
      resizeDisposable.dispose()
      dataDisposable.dispose()
      replayStateRef.current = serializeAddon.serialize()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [dom, scheduleResizeSync, scrollback, sendInput, sendResize, socket, terminalId, terminalTheme])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.scrollback = scrollback
  }, [scrollback])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = terminalTheme
    refreshTerminal(terminal)
  }, [terminalTheme])

  useEffect(() => {
    if (focusRequestVersion === 0) return

    const terminal = terminalRef.current
    if (!terminal) return

    timer.requestAnimationFrame(() => {
      terminal.focus()
    })
  }, [focusRequestVersion, timer])

  useEffect(() => {
    if (clearVersion === 0) return

    const terminal = terminalRef.current
    if (!terminal) return

    hasCreatedRef.current = false
    createAttemptRef.current += 1
    lastAppliedSnapshotKeyRef.current = null
    replayStateRef.current = null
    resetTerminal()
    terminal.reset()
    refreshTerminal(terminal)
    void socket.command({
      type: "terminal.close",
      terminalId,
    }).catch((commandError) => {
      storeSetError(commandError instanceof Error ? commandError.message : String(commandError))
    })
  }, [clearVersion, socket, terminalId, resetTerminal, storeSetError])

  useEffect(() => {
    onPathChange?.(metadata?.cwd ?? null)
  }, [metadata?.cwd, onPathChange])

  useEffect(() => {
    const applySnapshot = (snapshot: TerminalSnapshot) => {
      const terminal = terminalRef.current
      if (!terminal) return false
      const nextMetadata = {
        cwd: snapshot.cwd,
        shell: snapshot.shell,
        status: snapshot.status,
        exitCode: snapshot.exitCode,
      } satisfies Pick<TerminalSnapshot, "cwd" | "shell" | "status" | "exitCode">
      const snapshotKey = JSON.stringify({
        cwd: snapshot.cwd,
        shell: snapshot.shell,
        cols: snapshot.cols,
        rows: snapshot.rows,
        scrollback: snapshot.scrollback,
        status: snapshot.status,
        exitCode: snapshot.exitCode,
        serializedState: snapshot.serializedState,
      })
      if (lastAppliedSnapshotKeyRef.current === snapshotKey) {
        setMetadataConditional(nextMetadata)
        replayStateRef.current = snapshot.serializedState || null
        return false
      }
      lastAppliedSnapshotKeyRef.current = snapshotKey
      setMetadataConditional(nextMetadata)
      replayStateRef.current = snapshot.serializedState || null
      terminal.options.scrollback = snapshot.scrollback
      terminal.reset()
      if (snapshot.serializedState) {
        terminal.write(snapshot.serializedState)
      }
      refreshTerminal(terminal)
      return true
    }

    const ensureSession = () => {
      const terminal = terminalRef.current
      const element = containerRef.current
      if (!terminal || !element) return
      const size = getMeasuredTerminalSize(terminal, element, dom) ?? getTerminalSize(terminal)
      terminal.resize(size.cols, size.rows)
      lastSizeRef.current = size
      void socket.command<TerminalSnapshot | null>({
        type: "terminal.create",
        projectId,
        terminalId,
        cols: size.cols,
        rows: size.rows,
        scrollback,
      }).then((snapshot) => {
        hasCreatedRef.current = true
        storeSetError(null)
        if (snapshot) {
          applySnapshot(snapshot)
        }
        scheduleResizeSync()
      }).catch((commandError) => {
        storeSetError(commandError instanceof Error ? commandError.message : String(commandError))
      })
    }

    const scheduleSessionCreate = () => {
      const attempt = ++createAttemptRef.current
      const run = () => {
        if (createAttemptRef.current !== attempt) return
        const terminal = terminalRef.current
        const element = containerRef.current
        if (!terminal || !element) return

        syncTerminalSize(terminal, element, lastSizeRef, false, () => {}, dom)
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
          timer.requestAnimationFrame(run)
          return
        }

        ensureSession()
      }

      timer.requestAnimationFrame(() => {
        timer.requestAnimationFrame(run)
      })
    }

    scheduleSessionCreate()

    return socket.subscribeTerminal(terminalId, {
      onSnapshot: (snapshot) => {
        if (!snapshot) {
          hasCreatedRef.current = false
          lastAppliedSnapshotKeyRef.current = null
          if (connectionStatus === "connected") {
            scheduleSessionCreate()
          }
          return
        }
        hasCreatedRef.current = true
        storeSetError(null)
        if (applySnapshot(snapshot)) {
          scheduleResizeSync()
        }
      },
      onEvent: (event) => {
        const terminal = terminalRef.current
        if (!terminal) return
        if (event.type === "terminal.output") {
          terminal.write(event.data)
          return
        }
        if (event.type === "terminal.exit") {
          setMetadataFromExit(event.exitCode)
        }
      },
    })
  }, [connectionStatus, dom, projectId, scheduleResizeSync, scrollback, socket, terminalId, timer, setMetadataConditional, setMetadataFromExit, storeSetError])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-4">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden px-3 py-1">
        <div ref={containerRef} className="kanna-terminal min-h-0 min-w-0 flex-1 overflow-hidden w-full" />
      </div>
      {error ? <div className="px-3 py-1 text-xs text-destructive">Terminal error: {error}</div> : null}
    </div>
  )
}

export function TerminalPane(props: Props) {
  return (
    <TerminalPaneStore.Provider init={undefined}>
      <TerminalPaneInner {...props} />
    </TerminalPaneStore.Provider>
  )
}

