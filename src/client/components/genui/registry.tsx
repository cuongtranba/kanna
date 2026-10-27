import type { ComponentRenderer, ComponentRenderProps } from "@json-render/react"
import { GENUI_COMPONENTS, type GenUIComponentName } from "../../../shared/genui"
import { FinancialChartElement } from "./components/financial-chart"
import {
  CompareSelectorElement,
  CurrencySelectorElement,
  EntitySelectorElement,
  FinancialMetricElement,
  FinancialTableElement,
  PeriodSelectorElement,
  statementTableElement,
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
import { FlowDiagramElement } from "./components/flow-diagram"

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
  FlowDiagram: FlowDiagramElement,
  FinancialMetric: FinancialMetricElement,
  FinancialChart: FinancialChartElement,
  FinancialTable: FinancialTableElement,
  IncomeStatement: statementTableElement(GENUI_COMPONENTS.IncomeStatement.props, "Income statement"),
  BalanceSheet: statementTableElement(GENUI_COMPONENTS.BalanceSheet.props, "Balance sheet"),
  CashFlowStatement: statementTableElement(GENUI_COMPONENTS.CashFlowStatement.props, "Cash flow statement"),
  PeriodSelector: PeriodSelectorElement,
  CompareSelector: CompareSelectorElement,
  CurrencySelector: CurrencySelectorElement,
  EntitySelector: EntitySelectorElement,
} satisfies Record<GenUIComponentName, ComponentRenderer>

export function UnknownElement({ element }: ComponentRenderProps) {
  return <PropsIssue component={element.type} />
}
