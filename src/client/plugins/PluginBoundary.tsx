import { Component, type ReactNode } from "react"
import { log } from "../../shared/log"

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

  componentDidCatch(error: Error) {
    log.warn("[kanna/plugins] plugin failed to render", { pluginId: this.props.pluginId, message: error.message })
  }

  render() {
    return this.state.failed ? fallback(this.props.pluginId) : this.props.children
  }
}
