import { VChart } from "@visactor/vchart/esm/core"
import { registerAreaChart } from "@visactor/vchart/esm/chart/area/area"
import { registerBarChart } from "@visactor/vchart/esm/chart/bar/bar"
import { registerCommonChart } from "@visactor/vchart/esm/chart/common/common"
import { registerLineChart } from "@visactor/vchart/esm/chart/line/line"
import { registerPieChart } from "@visactor/vchart/esm/chart/pie/pie"
import { registerRangeColumnChart } from "@visactor/vchart/esm/chart/range-column/range-column"
import { registerCartesianBandAxis } from "@visactor/vchart/esm/component/axis/cartesian/band-axis"
import { registerCartesianLinearAxis } from "@visactor/vchart/esm/component/axis/cartesian/linear-axis"
import { registerCartesianCrossHair } from "@visactor/vchart/esm/component/crosshair/cartesian"
import { registerDiscreteLegend } from "@visactor/vchart/esm/component/legend/discrete/legend"
import { registerTooltip } from "@visactor/vchart/esm/component/tooltip/tooltip"
import { registerDomTooltipHandler } from "@visactor/vchart/esm/plugin/components/tooltip-handler/dom-tooltip-handler"

const REGISTRATIONS = [
  registerLineChart,
  registerAreaChart,
  registerBarChart,
  registerPieChart,
  registerCommonChart,
  registerRangeColumnChart,
  registerCartesianLinearAxis,
  registerCartesianBandAxis,
  registerDiscreteLegend,
  registerTooltip,
  registerCartesianCrossHair,
  registerDomTooltipHandler,
]

for (const register of REGISTRATIONS) register()

export { VChart }
