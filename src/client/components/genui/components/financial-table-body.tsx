import { Fragment } from "react"
import type { ComponentRenderProps } from "@json-render/react"
import { ChevronDown, ChevronRight } from "lucide-react"
import {
  computeVariance,
  dimensionLabel,
  formatMetricValue,
  metricLabel,
  valueFormatOf,
  type DatasetDecl,
  type DatasetQuery,
  type QueryResult,
  type QueryRow,
  type ValueFormat,
} from "../../../../shared/genui"
import { Button } from "../../ui/button"
import { cn } from "../../../lib/utils"
import { isBoolean, isStringList, useElementUiState } from "../useElementUiState"
import { sentimentTone, toneInkClass } from "./primitives"

type Element = ComponentRenderProps["element"]

const PAGE_SIZE = 50

export interface TableBodyConfig {
  variant: "detail" | "statement" | "comparison"
  metric?: string
  metrics?: string[]
  rows?: string
  groupRows?: string
  totals?: { label: string; groups: string[] }[]
}

interface Props {
  element: Element
  config: TableBodyConfig
  query: DatasetQuery
  result: QueryResult
  decl: DatasetDecl
}

const HEAD = "px-3 py-2 text-xs font-medium text-muted-foreground"
const CELL = "px-3 py-1.5 tabular-nums"

function rowLabel(row: QueryRow, dimension: string | undefined): string {
  return dimension ? row.dimensions[dimension] ?? "" : "Total"
}

function ShowMore({ total, onShow }: { total: number; onShow: () => void }) {
  return (
    <div className="border-t border-border px-3 py-2">
      <Button size="sm" variant="ghost" onClick={onShow}>Show all {total} rows</Button>
    </div>
  )
}

function DetailTable({ element, config, result, decl }: Omit<Props, "query">) {
  const [expanded, setExpanded] = useElementUiState(element, "expanded", false, isBoolean)
  const metrics = config.metrics ?? (config.metric ? [config.metric] : [])
  const rows = expanded ? result.rows : result.rows.slice(0, PAGE_SIZE)
  return (
    <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border">
            <th scope="col" className={cn(HEAD, "text-left")}>{config.rows ? dimensionLabel(config.rows, decl.dimensions?.[config.rows]) : ""}</th>
            {metrics.map((metric) => <th key={metric} scope="col" className={cn(HEAD, "text-right")}>{metricLabel(metric, decl.metrics[metric])}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="sticky left-0 bg-card px-3 py-1.5 text-left font-normal text-foreground">{rowLabel(row, config.rows)}</th>
              {metrics.map((metric) => (
                <td key={metric} className={cn(CELL, "text-right text-foreground")}>{formatMetricValue(row.values[metric] ?? null, valueFormatOf(decl.metrics[metric]))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!expanded && result.rows.length > PAGE_SIZE ? <ShowMore total={result.rows.length} onShow={() => setExpanded(true)} /> : null}
    </div>
  )
}

function VarianceCells({ value, compare, format, direction, accounting }: { value: number | null; compare: number | null; format: ValueFormat; direction: DatasetDecl["metrics"][string]["direction"]; accounting: boolean }) {
  const variance = computeVariance(value, compare, format, direction)
  const ink = toneInkClass(sentimentTone(variance.sentiment))
  return (
    <>
      <td className={cn(CELL, "text-right text-muted-foreground")}>{formatMetricValue(compare, format, { accounting })}</td>
      <td className={cn(CELL, "text-right", ink)}>{variance.amountText}</td>
      <td className={cn(CELL, "text-right", ink)}>{variance.ratioText}</td>
    </>
  )
}

function comparisonHeaders(label: string) {
  return (
    <>
      <th scope="col" className={cn(HEAD, "text-right")}>{label}</th>
      <th scope="col" className={cn(HEAD, "text-right")}>Change</th>
      <th scope="col" className={cn(HEAD, "text-right")}>Change %</th>
    </>
  )
}

function ComparisonTable({ element, config, result, decl }: Omit<Props, "query">) {
  const [expanded, setExpanded] = useElementUiState(element, "expanded", false, isBoolean)
  const metric = config.metric ?? config.metrics?.[0] ?? ""
  const def = decl.metrics[metric]
  const format = valueFormatOf(def)
  const rows = expanded ? result.rows : result.rows.slice(0, PAGE_SIZE)
  const baseline = result.comparison?.label
  return (
    <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border">
            <th scope="col" className={cn(HEAD, "text-left")}>{config.rows ? dimensionLabel(config.rows, decl.dimensions?.[config.rows]) : ""}</th>
            <th scope="col" className={cn(HEAD, "text-right")}>{metricLabel(metric, def)}</th>
            {baseline ? comparisonHeaders(baseline) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="sticky left-0 bg-card px-3 py-1.5 text-left font-normal text-foreground">{rowLabel(row, config.rows)}</th>
              <td className={cn(CELL, "text-right text-foreground")}>{formatMetricValue(row.values[metric] ?? null, format)}</td>
              {baseline ? <VarianceCells value={row.values[metric] ?? null} compare={row.compare?.[metric] ?? null} format={format} direction={def?.direction} accounting={false} /> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {!expanded && result.rows.length > PAGE_SIZE ? <ShowMore total={result.rows.length} onShow={() => setExpanded(true)} /> : null}
    </div>
  )
}

interface StatementGroup {
  name: string
  rows: QueryRow[]
  value: number | null
  compare: number | null
}

function sum(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter((value): value is number => typeof value === "number")
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0)
}

export function statementGroups(result: QueryResult, metric: string, groupDimension: string | undefined): StatementGroup[] {
  const groups = new Map<string, QueryRow[]>()
  for (const row of result.rows) {
    const name = groupDimension ? row.dimensions[groupDimension] ?? "" : ""
    const list = groups.get(name) ?? []
    list.push(row)
    groups.set(name, list)
  }
  return [...groups.entries()].map(([name, rows]) => ({
    name,
    rows,
    value: sum(rows.map((row) => row.values[metric])),
    compare: sum(rows.map((row) => row.compare?.[metric])),
  }))
}

function StatementTable({ element, config, result, decl }: Omit<Props, "query">) {
  const [collapsedGroups, setCollapsedGroups] = useElementUiState<string[]>(element, "collapsed", [], isStringList)
  const collapsed = new Set(collapsedGroups)
  const metric = config.metric ?? config.metrics?.[0] ?? ""
  const def = decl.metrics[metric]
  const format = valueFormatOf(def)
  const baseline = result.comparison?.label
  const groups = statementGroups(result, metric, config.groupRows)
  const toggle = (name: string) => {
    setCollapsedGroups(collapsed.has(name) ? collapsedGroups.filter((group) => group !== name) : [...collapsedGroups, name])
  }
  const amount = (value: number | null) => formatMetricValue(value, format, { accounting: true })
  const totals = (config.totals ?? []).map((total) => {
    const included = groups.filter((group) => total.groups.includes(group.name))
    return { label: total.label, value: sum(included.map((group) => group.value)), compare: sum(included.map((group) => group.compare)) }
  })
  return (
    <div className="max-h-[32rem] overflow-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border">
            <th scope="col" className={cn(HEAD, "text-left")}>{config.rows ? dimensionLabel(config.rows, decl.dimensions?.[config.rows]) : ""}</th>
            <th scope="col" className={cn(HEAD, "text-right")}>{result.period.label}</th>
            {baseline ? comparisonHeaders(baseline) : null}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.name)
            const grouped = Boolean(config.groupRows)
            return (
              <Fragment key={group.name || "_"}>
                {grouped ? (
                  <tr className="border-t border-border">
                    <th scope="rowgroup" className="sticky left-0 bg-card px-2 py-1.5 text-left font-medium text-foreground">
                      <button
                        type="button"
                        onClick={() => toggle(group.name)}
                        aria-expanded={!isCollapsed}
                        className="flex items-center gap-1 rounded px-1 hover:bg-muted"
                      >
                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
                        {group.name}
                      </button>
                    </th>
                    <td className={cn(CELL, "text-right font-medium text-foreground")}>{amount(group.value)}</td>
                    {baseline ? <VarianceCells value={group.value} compare={group.compare} format={format} direction={def?.direction} accounting /> : null}
                  </tr>
                ) : null}
                {isCollapsed ? null : group.rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row" className={cn("sticky left-0 bg-card py-1 text-left font-normal text-foreground", grouped ? "pl-9 pr-3" : "px-3")}>{rowLabel(row, config.rows)}</th>
                    <td className={cn(CELL, "text-right text-foreground")}>{amount(row.values[metric] ?? null)}</td>
                    {baseline ? <VarianceCells value={row.values[metric] ?? null} compare={row.compare?.[metric] ?? null} format={format} direction={def?.direction} accounting /> : null}
                  </tr>
                ))}
              </Fragment>
            )
          })}
          {totals.map((total) => (
            <tr key={total.label} className="border-t-2 border-border">
              <th scope="row" className="sticky left-0 bg-card px-3 py-2 text-left font-semibold text-foreground">{total.label}</th>
              <td className={cn(CELL, "text-right font-semibold text-foreground")}>{amount(total.value)}</td>
              {baseline ? <VarianceCells value={total.value} compare={total.compare} format={format} direction={def?.direction} accounting /> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function FinancialTableBody({ element, config, result, decl }: Props) {
  if (result.rows.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">No data for the selected period</p>
  }
  switch (config.variant) {
    case "statement":
      return <StatementTable element={element} config={config} result={result} decl={decl} />
    case "comparison":
      return <ComparisonTable element={element} config={config} result={result} decl={decl} />
    case "detail":
      return <DetailTable element={element} config={config} result={result} decl={decl} />
  }
}
