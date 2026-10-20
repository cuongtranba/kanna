import { boardTools } from "./remote-mcp-tools-boards"
import { chatTools } from "./remote-mcp-tools-chat"
import { cronTools } from "./remote-mcp-tools-cron"
import { fileTools } from "./remote-mcp-tools-files"
import { genericTools } from "./remote-mcp-tools-generic"
import { gitTools } from "./remote-mcp-tools-git"
import { observabilityTools } from "./remote-mcp-tools-observability"
import { projectTools } from "./remote-mcp-tools-projects"
import { settingsTools } from "./remote-mcp-tools-settings"
import { systemTools } from "./remote-mcp-tools-system"
import type { RemoteTool } from "./remote-mcp-tool-spec"

export const REMOTE_TOOLS: readonly RemoteTool[] = [
  ...genericTools,
  ...projectTools,
  ...chatTools,
  ...gitTools,
  ...boardTools,
  ...cronTools,
  ...settingsTools,
  ...observabilityTools,
  ...fileTools,
  ...systemTools,
]
