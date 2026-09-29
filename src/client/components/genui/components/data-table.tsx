import { useMemo } from "react"
import type { ComponentRenderProps } from "@json-render/react"
import {
  dimensionLabel,
  formatMetricValue,
  GENUI_COMPONENTS,
  humanizeIdentifier,
  metricLabel,
  valueFormatOf,
  type DatasetDecl,
  type DatasetQuery,
  type QueryResult,
} from "../../../../shared/genui"
import { isJsonObject, type JsonObject, type JsonValue } from "../../../../shared/json"
import { Button } from "../../ui/button"
import { cn } from "../../../lib/utils"
import { useDatasetDecl, useDatasetQuery } from "../useDatasetQuery"
import { useDrillState } from "./financial-chart"
import { isBoolean, useElementUiState } from "../useElementUiState"
import { DataStateNotice, PropsIssue } from "./primitives"
import { compareOf, resolvedProps, withDrillFilter } from "./props"

const PAGE_SIZE = 50
const HEAD = "px-3 py-2 text-xs font-medium text-muted-foreground"

interface Column {
  key: string
  label: string
  numeric: boolean
}

interface TableRow {
  key: string
  cells: Record<string, string>
}

function cellText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "—"
  if (typeof value === "string") return value
  if (typeof value === "number") return new Intl.NumberFormat("en-US").format(value)
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return JSON.stringify(value)
}

function staticTable(columns: readonly { key: string; label: string }[] | undefined, rows: readonly JsonObject[]): { columns: Column[]; rows: TableRow[] } {
  const keys = columns ?? Object.keys(rows[0] ?? {}).map((key) => ({ key, label: humanizeIdentifier(key) }))
  return {
    columns: keys.map((column) => ({ ...column, numeric: rows.every((row) => typeof row[column.key] === "number" || row[column.key] === undefined) })),
    rows: rows.map((row, index) => ({ key: String(index), cells: Object.fromEntries(keys.map((column) => [column.key, cellText(row[column.key])])) })),
  }
}

function datasetTable(decl: DatasetDecl, dimensions: readonly string[], metrics: readonly string[], result: QueryResult): { columns: Column[]; rows: TableRow[] } {
  const comparison = result.comparison?.label
  const columns: Column[] = [
    ...dimensions.map((id) => ({ key: `d:${id}`, label: dimensionLabel(id, decl.dimensions?.[id]), numeric: false })),
    ...metrics.flatMap((id) => [
      { key: `m:${id}`, label: metricLabel(id, decl.metrics[id]), numeric: true },
      ...(comparison ? [{ key: `c:${id}`, label: `${metricLabel(id, decl.metrics[id])} (${comparison})`, numeric: true }] : []),
    ]),
  ]
  const rows = result.rows.map((row) => ({
    key: row.key,
    cells: Object.fromEntries([
      ...dimensions.map((id) => [`d:${id}`, row.dimensions[id] ?? ""]),
      ...metrics.flatMap((id) => [
        [`m:${id}`, formatMetricValue(row.values[id] ?? null, valueFormatOf(decl.metrics[id]))],
        ...(comparison ? [[`c:${id}`, formatMetricValue(row.compare?.[id] ?? null, valueFormatOf(decl.metrics[id]))]] : []),
      ]),
    ]),
  }))
  return { columns, rows }
}

function Table({ element, columns, rows, title }: { element: ComponentRenderProps["element"]; columns: Column[]; rows: TableRow[]; title?: string }) {
  const [expanded, setExpanded] = useElementUiState(element, "expanded", false, isBoolean)
  const visible = expanded ? rows : rows.slice(0, PAGE_SIZE)
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      {title ? <figcaption className="text-sm font-medium text-foreground">{title}</figcaption> : null}
      <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border">
              {columns.map((column) => (
                <th key={column.key} scope="col" className={cn(HEAD, column.numeric ? "text-right" : "text-left")}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((row) => (
              <tr key={row.key}>
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-3 py-1.5 text-foreground", column.numeric ? "text-right tabular-nums" : "text-left")}>{row.cells[column.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!expanded && rows.length > PAGE_SIZE ? (
          <div className="border-t border-border px-3 py-2">
            <Button size="sm" variant="ghost" onClick={() => setExpanded(true)}>Show all {rows.length} rows</Button>
          </div>
        ) : null}
      </div>
    </figure>
  )
}

export function DataTableElement({ element }: ComponentRenderProps) {
  const props = useMemo(() => {
    const parsed = GENUI_COMPONENTS.DataTable.props.safeParse(resolvedProps(element.props))
    return parsed.success ? parsed.data : null
  }, [element.props])
  const decl = useDatasetDecl(props?.dataset)
  const drill = useDrillState(props?.dataset)
  const query = useMemo((): DatasetQuery | null => {
    if (!props?.dataset || !props.metrics) return null
    const compare = compareOf(props.compareWith)
    const filters = withDrillFilter(props.filters, drill)
    return {
      metrics: props.metrics,
      groupBy: props.dimensions ?? [],
      ...(props.period ? { period: props.period } : {}),
      ...(compare ? { compare } : {}),
      ...(filters && filters.length > 0 ? { filters } : {}),
      limit: props.limit ?? 200,
    }
  }, [drill, props])
  const state = useDatasetQuery(props?.dataset, query)
  if (!props) return <PropsIssue component="DataTable" />
  if (!props.dataset) {
    const rows = (props.rows ?? []).filter(isJsonObject)
    return <Table element={element} {...staticTable(props.columns, rows)} title={props.title} />
  }
  if (!props.metrics) return <PropsIssue component="DataTable" />
  if (state.status !== "ok") return <DataStateNotice state={state} />
  if (!decl) return <PropsIssue component="DataTable" />
  return <Table element={element} {...datasetTable(decl, props.dimensions ?? [], props.metrics, state.result)} title={props.title} />
}
