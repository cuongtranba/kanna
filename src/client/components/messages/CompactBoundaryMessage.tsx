function ZigZagLine({ size = 4 }: { size?: number }) {
  return (
    <svg className="flex-1" viewBox={`0 0 100 ${size}`} preserveAspectRatio="none" style={{ height: `${size}px` }}>
      <pattern id="zigzag" width={size} height={size} patternUnits="userSpaceOnUse">
        <path d={`M0 ${size} L${size / 2} 0 L${size} ${size}`} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-muted-foreground/30" style={{ stroke: 'currentColor' }} />
      </pattern>
      <rect width="100%" height={size} fill="url(#zigzag)" className="text-muted-foreground/30" />
    </svg>
  )
}

export function CompactBoundaryMessage() {
  return (
    <div className="flex items-center gap-3">
      <ZigZagLine />
      <span className="text-11 tracking-widest text-muted-foreground uppercase flex-shrink-0">Compacted</span>
      <ZigZagLine />
    </div>
  )
}

export function ContextClearedMessage() {
  return (
    <div className="flex items-center gap-3">
      <ZigZagLine />
      <span className="text-11 tracking-widest text-muted-foreground uppercase flex-shrink-0">Context Cleared</span>
      <ZigZagLine />
    </div>
  )
}
