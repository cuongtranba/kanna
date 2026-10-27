import { Children } from "react"
import { useActions, useBoundProp, type ComponentRenderProps } from "@json-render/react"
import { GENUI_COMPONENTS } from "../../../../shared/genui"
import { Button } from "../../ui/button"
import { SegmentedControl } from "../../ui/segmented-control"
import { cn } from "../../../lib/utils"
import { isString, useElementUiState } from "../useElementUiState"
import { defineElement } from "./define-element"
import { ToneIcon, toneInkClass } from "./primitives"

const GAP = { sm: "gap-2", md: "gap-3", lg: "gap-5" } as const

const GRID_COLUMNS: Readonly<Record<number, string>> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @md:grid-cols-2",
  3: "grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3",
  4: "grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-4",
}

export const StackElement = defineElement(GENUI_COMPONENTS.Stack.props, ({ props, children }) => {
  const horizontal = props.direction === "horizontal"
  return (
    <div className={cn("flex min-w-0", horizontal ? "flex-row flex-wrap items-start" : "flex-col", GAP[props.gap ?? "md"])}>
      {children}
    </div>
  )
})

export const GridElement = defineElement(GENUI_COMPONENTS.Grid.props, ({ props, children }) => {
  return (
    <div className={cn("grid min-w-0", GRID_COLUMNS[props.columns ?? 2], GAP[props.gap ?? "md"])}>
      {children}
    </div>
  )
})

export const CardElement = defineElement(GENUI_COMPONENTS.Card.props, ({ props, children }) => {
  return (
    <section className="min-w-0 rounded-md border border-border p-3" aria-label={props.title}>
      {props.title ? <h4 className="text-sm font-medium text-foreground">{props.title}</h4> : null}
      {props.description ? <p className="mt-0.5 text-xs text-muted-foreground">{props.description}</p> : null}
      <div className={cn("flex flex-col gap-3", (props.title || props.description) && "mt-3")}>{children}</div>
    </section>
  )
})

export const SectionElement = defineElement(GENUI_COMPONENTS.Section.props, ({ props, children }) => {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={props.title}>
      <div>
        <h4 className="text-sm font-medium text-foreground">{props.title}</h4>
        {props.description ? <p className="text-xs text-muted-foreground">{props.description}</p> : null}
      </div>
      {children}
    </section>
  )
})

export const TabsElement = defineElement(GENUI_COMPONENTS.Tabs.props, ({ element, props, children, bindings }) => {
  const { items } = props
  const [bound, setBound] = useBoundProp(props.value, bindings?.value)
  const [local, setLocal] = useElementUiState(element, "tab", items[0]?.value ?? "", isString)
  const active = bindings?.value ? bound ?? items[0]?.value ?? "" : local
  const select = (value: string) => {
    if (bindings?.value) setBound(value)
    else setLocal(value)
  }
  const panels = Children.toArray(children)
  const index = Math.max(0, items.findIndex((item) => item.value === active))
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SegmentedControl size="sm" value={items[index]?.value ?? ""} onValueChange={select} options={items.map((item) => ({ value: item.value, label: item.label }))} />
      <div role="tabpanel">{panels[index] ?? null}</div>
    </div>
  )
})

const TEXT_VARIANT = {
  body: "text-sm text-foreground",
  muted: "text-sm text-muted-foreground",
  heading: "text-base font-medium text-foreground",
  label: "text-xs font-medium text-muted-foreground",
} as const

export const TextElement = defineElement(GENUI_COMPONENTS.Text.props, ({ props }) => {
  return <p className={cn("whitespace-pre-wrap break-words", TEXT_VARIANT[props.variant ?? "body"])}>{props.text}</p>
})

export const BadgeElement = defineElement(GENUI_COMPONENTS.Badge.props, ({ props }) => {
  const tone = props.tone ?? "neutral"
  return (
    <span className={cn("inline-flex w-fit items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs font-medium", toneInkClass(tone))}>
      <ToneIcon tone={tone} />
      {props.label}
    </span>
  )
})

const BUTTON_VARIANT = { primary: "default", secondary: "outline", ghost: "ghost" } as const

type PressBindings = NonNullable<ComponentRenderProps["element"]["on"]>[string]

function boundActionNames(bindings: PressBindings | undefined): string[] {
  if (!bindings) return []
  return (Array.isArray(bindings) ? bindings : [bindings]).map((binding) => binding.action)
}

export const ButtonElement = defineElement(GENUI_COMPONENTS.Button.props, ({ element, props, emit }) => {
  const { loadingActions } = useActions()
  const pending = boundActionNames(element.on?.press).some((action) => loadingActions.has(action))
  return (
    <Button
      size="sm"
      variant={BUTTON_VARIANT[props.variant ?? "secondary"]}
      className="w-fit"
      pending={pending}
      onClick={() => emit("press")}
    >
      {props.label}
    </Button>
  )
})

export function DividerElement() {
  return <hr className="border-border" />
}
