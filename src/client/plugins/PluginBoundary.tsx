/**
 * Isolates one contributed plugin surface from the rest of the host chat UI.
 * A plugin panel is third-party code running inside the host process — a
 * render-time throw in it must not take down whatever else is mounted
 * alongside it (the sidebar, the chat transcript, other plugin panels).
 *
 * Two catching mechanisms, covering two DIFFERENT render paths:
 *
 * 1. `getDerivedStateFromError` — the real, standard React error boundary.
 *    This is what protects a live browser (Fiber) render: React's own
 *    reconciler bubbles a descendant's render-phase throw up to the nearest
 *    ancestor that defines it, including throws caused by the plugin's OWN
 *    later state updates, which nothing else here can foresee. It preserves
 *    full hook semantics for the child on the happy path (nothing here
 *    replaces `this.props.children` with a manually-invoked call, which
 *    would run the child outside of any fiber and break its hooks — MEASURED:
 *    calling `useState`-using JSX by hand throws "Invalid hook call" even
 *    when done from inside a class's own `render()`).
 * 2. A synchronous trial render via `renderToStaticMarkup` — MEASURED: React
 *    19's legacy `renderToStaticMarkup`/`renderToString` do not run
 *    `getDerivedStateFromError` at all; any render-phase throw aborts the
 *    ENTIRE call as fatal, regardless of an ancestor boundary. Rendering the
 *    same children through a throwaway, fully self-contained
 *    `renderToStaticMarkup` call first — discarding its output, keeping only
 *    whether it threw — detects that case before the REAL return happens, so
 *    the outer call the host is running never sees the throw. This nested
 *    call is itself a real, standalone render pass, so the child's hooks run
 *    normally inside it (unlike a manual invocation) — it is safe for a
 *    stateful panel like the "hello" fixture's counter.
 *
 * The trial runs on every render, including in the browser — an acceptable
 * cost for a low-frequency surface (a handful of plugin panels, not a hot
 * loop), and harmless on the happy path since its output is never used.
 */
import { Component, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

export interface PluginBoundaryProps {
  readonly pluginId: string
  readonly children: ReactNode
}

interface PluginBoundaryState {
  readonly failed: boolean
}

function fallback(pluginId: string) {
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
      data-testid={`plugin-boundary-error:${pluginId}`}
    >
      Plugin &quot;{pluginId}&quot; failed to render.
    </div>
  )
}

export class PluginBoundary extends Component<PluginBoundaryProps, PluginBoundaryState> {
  state: PluginBoundaryState = { failed: false }

  static getDerivedStateFromError(): PluginBoundaryState {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return fallback(this.props.pluginId)

    try {
      renderToStaticMarkup(<>{this.props.children}</>)
    } catch {
      return fallback(this.props.pluginId)
    }
    return this.props.children
  }
}
