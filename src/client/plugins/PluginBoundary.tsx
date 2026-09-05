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
