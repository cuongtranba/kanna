import { Input } from "../components/ui/input"
import { Textarea } from "../components/ui/textarea"
import type { SubagentInput } from "../../shared/types"
import { FormRow } from "./SubagentFormRow"

export function SubagentScopeFields(props: {
  draft: SubagentInput
  patchDraft: (patch: Partial<SubagentInput>) => void
}) {
  const { draft, patchDraft } = props
  return (
    <>
      <FormRow
        label="Working directory"
        hint="Optional. Relative to the parent chat cwd. Restricts the subagent's filesystem access to this subtree."
      >
        <Input
          data-testid="subagent-form-working-dir"
          value={draft.workingDir ?? ""}
          onChange={(event) => {
            const v = event.target.value
            patchDraft({ workingDir: v.length > 0 ? v : undefined })
          }}
          placeholder="docs"
        />
      </FormRow>

      <FormRow
        label="Allowed paths"
        hint="Optional. Newline-separated, relative to the parent chat cwd. When set, file tools can only read/write inside these roots."
      >
        <Textarea
          data-testid="subagent-form-allowed-paths"
          value={(draft.allowedPaths ?? []).join("\n")}
          onChange={(event) => {
            const lines = event.target.value
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l.length > 0)
            patchDraft({ allowedPaths: lines.length > 0 ? lines : undefined })
          }}
          placeholder={"docs\nwiki"}
          rows={3}
        />
      </FormRow>

      <FormRow
        label="Beacon tools"
        hint="Off by default. When on, this subagent can run commands and read files on your paired machines. Each call still asks for your approval."
      >
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            data-testid="subagent-form-allow-beacon-tools"
            checked={draft.allowBeaconTools === true}
            onChange={(event) => {
              patchDraft({ allowBeaconTools: event.target.checked })
            }}
          />
          <span>Allow this subagent to use beacon tools (run on your paired machines)</span>
        </label>
      </FormRow>
    </>
  )
}
