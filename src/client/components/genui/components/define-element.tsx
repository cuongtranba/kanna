import { useMemo, type ComponentType } from "react"
import type { ComponentRenderProps } from "@json-render/react"
import type { z } from "zod"
import type { JsonObject } from "../../../../shared/json"
import { PropsIssue } from "./primitives"
import { resolvedProps } from "./props"

export type ElementProps<S extends z.ZodType<JsonObject>> = ComponentRenderProps & {
  props: z.output<S>
}

function parseProps<S extends z.ZodType<JsonObject>>(schema: S, input: JsonObject | null): z.output<S> | null {
  const parsed = schema.safeParse(input)
  return parsed.success ? parsed.data : null
}

export function defineElement<S extends z.ZodType<JsonObject>>(
  schema: S,
  Render: ComponentType<ElementProps<S>>,
): ComponentType<ComponentRenderProps> {
  function GenUIElement(rendered: ComponentRenderProps) {
    const props = useMemo(() => parseProps(schema, resolvedProps(rendered.element.props)), [rendered.element.props])
    if (!props) return <PropsIssue component={rendered.element.type} />
    return <Render {...rendered} props={props} />
  }
  return GenUIElement
}
