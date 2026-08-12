import {
  Panel,
  Group,
  Separator,
  type GroupProps,
  type Orientation,
  type PanelProps,
  type SeparatorProps,
} from "react-resizable-panels"
import { cn } from "../../lib/utils"

const ResizablePanelGroup = ({
  className,
  ...props
}: GroupProps) => (
  <Group
    className={cn("flex h-full w-full", className)}
    {...props}
  />
)

const ResizablePanel = (props: PanelProps) => <Panel {...props} />

/**
 * The strip is deliberately wider than the line it draws: the hairline is the
 * signal, the padded strip is the target. Negative margins cancel that padding,
 * so a fatter grab area costs the panes no space. A coarse pointer gets a
 * fingertip-sized strip — touch devices render the real pane tree above the md
 * breakpoint, so this is a divider a finger has to be able to land on.
 */
const GRAB_AREA: Record<Orientation, string> = {
  vertical: "h-3 w-full -my-1.5 cursor-row-resize pointer-coarse:h-5 pointer-coarse:-my-2.5",
  horizontal: "h-full w-3 -mx-1.5 cursor-col-resize pointer-coarse:w-5 pointer-coarse:-mx-2.5",
}

/**
 * Lit from the library's `data-separator` rather than `:hover` / `:active`: a
 * drag holds pointer capture and travels well outside the strip, so a
 * pseudo-class would drop the highlight exactly when it matters most.
 */
const HAIRLINE: Record<Orientation, string> = {
  vertical:
    "before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 data-[separator=hover]:before:h-0.5 data-[separator=active]:before:h-0.5",
  horizontal:
    "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 data-[separator=hover]:before:w-0.5 data-[separator=active]:before:w-0.5",
}

const HAIRLINE_COLOR =
  "before:bg-border before:transition-colors data-[separator=hover]:before:bg-ring data-[separator=active]:before:bg-ring focus-visible:before:bg-ring"

const ResizableHandle = ({
  withHandle,
  orientation,
  disabled,
  className,
  ...props
}: SeparatorProps & {
  withHandle?: boolean
  orientation: Orientation
}) => (
  <Separator
    disabled={disabled}
    className={cn(
      "relative flex items-center justify-center bg-transparent focus-visible:outline-none",
      GRAB_AREA[orientation],
      withHandle && HAIRLINE[orientation],
      withHandle && HAIRLINE_COLOR,
      className
    )}
    {...props}
  >
    <span className="sr-only">{orientation === "vertical" ? "Resize rows" : "Resize columns"}</span>
  </Separator>
)

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
