import type { PluginSurfaceProps } from "@kanna/plugin"
import { useState } from "react"

export function HelloPanel({ theme }: PluginSurfaceProps) {
  const [count, setCount] = useState(0)
  return (
    <div style={{ color: theme.colors.foreground }}>
      <span>hello-plugin-surface</span>
      <button type="button" onClick={() => setCount(count + 1)}>{count}</button>
    </div>
  )
}
