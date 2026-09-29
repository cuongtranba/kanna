import { Children } from "react"
import { useActions, useBoundProp, type ComponentRenderProps } from "@json-render/react"
import { GENUI_COMPONENTS } from "../../../../shared/genui"
import { Button } from "../../ui/button"
import { SegmentedControl } from "../../ui/segmented-control"
import { cn } from "../../../lib/utils"
import { isString, useElementUiState } from "../useElementUiState"
import { PropsIssue, ToneIcon, toneInkClass } from "./primitives"
import { resolvedProps } from "./props"

const GAP = { sm: "gap-2", md: "gap-3", lg: "gap-5" } as const

const GRID_COLUMNS: Readonly<Record<number, string>> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @md:grid-cols-2",
  3: "grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3",
  4: "grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-4",
}

export function StackElement({ element, children }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.Stack.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="Stack" />
  const horizontal = parsed.data.direction === "horizontal"
  return (
    <div className={cn("flex min-w-0", horizontal ? "flex-row flex-wrap items-start" : "flex-col", GAP[parsed.data.gap ?? "md"])}>
      {children}
    </div>
  )
}

export function GridElement({ element, children }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.Grid.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="Grid" />
  return (
    <div className={cn("grid min-w-0", GRID_COLUMNS[parsed.data.columns ?? 2], GAP[parsed.data.gap ?? "md"])}>
      {children}
    </div>
  )
}

export function CardElement({ element, children }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.Card.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="Card" />
  return (
    <section className="min-w-0 rounded-md border border-border p-3">
      {parsed.data.title ? <h4 className="text-sm font-medium text-foreground">{parsed.data.title}</h4> : null}
      {parsed.data.description ? <p className="mt-0.5 text-xs text-muted-foreground">{parsed.data.description}</p> : null}
      <div className={cn("flex flex-col gap-3", (parsed.data.title || parsed.data.description) && "mt-3")}>{children}</div>
    </section>
  )
}

export function SectionElement({ element, children }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.Section.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="Section" />
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div>
        <h4 className="text-sm font-medium text-foreground">{parsed.data.title}</h4>
        {parsed.data.description ? <p className="text-xs text-muted-foreground">{parsed.data.description}</p> : null}
      </div>
      {children}
    </section>
  )
}

export function TabsElement({ element, children, bindings }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.Tabs.props.safeParse(resolvedProps(element.props))
  const items = parsed.success ? parsed.data.items : []
  const [bound, setBound] = useBoundProp(parsed.success ? parsed.data.value : undefined, bindings?.value)
  const [local, setLocal] = useElementUiState(element, "tab", items[0]?.value ?? "", isString)
  if (!parsed.success) return <PropsIssue component="Tabs" />
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
}

const TEXT_VARIANT = {
  body: "text-sm text-foreground",
  muted: "text-sm text-muted-foreground",
  heading: "text-base font-medium text-foreground",
  label: "text-xs font-medium text-muted-foreground",
} as const

export function TextElement({ element }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.Text.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="Text" />
  return <p className={cn("whitespace-pre-wrap break-words", TEXT_VARIANT[parsed.data.variant ?? "body"])}>{parsed.data.text}</p>
}

export function BadgeElement({ element }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.Badge.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="Badge" />
  const tone = parsed.data.tone ?? "neutral"
  return (
    <span className={cn("inline-flex w-fit items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs font-medium", toneInkClass(tone))}>
      <ToneIcon tone={tone} />
      {parsed.data.label}
    </span>
  )
}

const BUTTON_VARIANT = { primary: "default", secondary: "outline", ghost: "ghost" } as const

type PressBindings = NonNullable<ComponentRenderProps["element"]["on"]>[string]

function boundActionNames(bindings: PressBindings | undefined): string[] {
  if (!bindings) return []
  return (Array.isArray(bindings) ? bindings : [bindings]).map((binding) => binding.action)
}

export function ButtonElement({ element, emit }: ComponentRenderProps) {
  const { loadingActions } = useActions()
  const parsed = GENUI_COMPONENTS.Button.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="Button" />
  const pending = boundActionNames(element.on?.press).some((action) => loadingActions.has(action))
  return (
    <Button
      size="sm"
      variant={BUTTON_VARIANT[parsed.data.variant ?? "secondary"]}
      className="w-fit"
      pending={pending}
      onClick={() => emit("press")}
    >
      {parsed.data.label}
    </Button>
  )
}

export function DividerElement() {
  return <hr className="border-border" />
}
