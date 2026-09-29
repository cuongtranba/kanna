import type { ComponentRenderer, ComponentRenderProps } from "@json-render/react"
import type { GenUIComponentName } from "../../../shared/genui"
import { FinancialChartElement } from "./components/financial-chart"
import {
  CompareSelectorElement,
  DimensionSelectorElement,
  FinancialMetricElement,
  FinancialTableElement,
  PeriodSelectorElement,
} from "./components/financial"
import {
  BadgeElement,
  ButtonElement,
  CardElement,
  DividerElement,
  GridElement,
  SectionElement,
  StackElement,
  TabsElement,
  TextElement,
} from "./components/layout"
import { PropsIssue } from "./components/primitives"
import {
  DiagnosticListElement,
  FileListElement,
  KeyValueElement,
  TestResultElement,
  TimelineElement,
} from "./components/records"
import { DataTableElement } from "./components/data-table"

export const GENUI_REGISTRY = {
  Stack: StackElement,
  Grid: GridElement,
  Card: CardElement,
  Section: SectionElement,
  Tabs: TabsElement,
  Text: TextElement,
  Badge: BadgeElement,
  Button: ButtonElement,
  Divider: DividerElement,
  KeyValue: KeyValueElement,
  DataTable: DataTableElement,
  FileList: FileListElement,
  DiagnosticList: DiagnosticListElement,
  TestResult: TestResultElement,
  Timeline: TimelineElement,
  FinancialMetric: FinancialMetricElement,
  FinancialChart: FinancialChartElement,
  FinancialTable: FinancialTableElement,
  IncomeStatement: FinancialTableElement,
  BalanceSheet: FinancialTableElement,
  CashFlowStatement: FinancialTableElement,
  PeriodSelector: PeriodSelectorElement,
  CompareSelector: CompareSelectorElement,
  CurrencySelector: DimensionSelectorElement,
  EntitySelector: DimensionSelectorElement,
} satisfies Record<GenUIComponentName, ComponentRenderer>

export function UnknownElement({ element }: ComponentRenderProps) {
  return <PropsIssue component={element.type} />
}
