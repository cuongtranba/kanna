import { useId } from "react"

const TILE_WIDTH = 8
const TILE_HEIGHT = 6

function ZigZagLine() {
  const patternId = `zigzag-${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  return (
    <svg aria-hidden className="flex-1 text-border" height={TILE_HEIGHT}>
      <pattern id={patternId} width={TILE_WIDTH} height={TILE_HEIGHT} patternUnits="userSpaceOnUse">
        <path
          d={`M0 ${TILE_HEIGHT - 1} L${TILE_WIDTH / 2} 1 L${TILE_WIDTH} ${TILE_HEIGHT - 1}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </pattern>
      <rect width="100%" height={TILE_HEIGHT} fill={`url(#${patternId})`} />
    </svg>
  )
}

function BoundaryRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <ZigZagLine />
      <span className="text-xs tracking-widest text-muted-foreground flex-shrink-0">{label}</span>
      <ZigZagLine />
    </div>
  )
}

export function CompactBoundaryMessage() {
  return <BoundaryRule label="Compacted" />
}

export function ContextClearedMessage() {
  return <BoundaryRule label="Context Cleared" />
}
