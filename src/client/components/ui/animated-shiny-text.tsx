import type { ComponentPropsWithoutRef, FC, ReactNode } from "react"

import { cn } from "../../lib/utils"

export type AnimatedShinyTextProps = ComponentPropsWithoutRef<"span"> & {
  shimmerWidth?: number
  animate?: boolean
  children?: ReactNode
}

export const AnimatedShinyText: FC<AnimatedShinyTextProps> = ({
  children,
  className,
  animate = true,
  shimmerWidth: _shimmerWidth,
  ...rest
}) => {
  return (
    <span
      className={cn(
        "mx-auto max-w-md text-foreground/60",
        animate && "animate-shiny-pulse",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
