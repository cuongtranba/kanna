import { SearchableSelect } from "../components/ui/searchable-select"
import type { WebhookTargetOption } from "../lib/webhookTargets"

interface Props {
  id: string
  value: string
  options: readonly WebhookTargetOption[]
  placeholder: string
  searchPlaceholder: string
  onValueChange: (value: string) => void
}

export function WebhookTargetSelect({ id, value, options, placeholder, searchPlaceholder, onValueChange }: Props) {
  return (
    <SearchableSelect
      id={id}
      value={value}
      options={options}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyMessage="Nothing to choose from yet"
      onValueChange={onValueChange}
    />
  )
}
