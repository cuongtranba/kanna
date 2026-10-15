import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import type { WebhookTargetOption } from "../lib/webhookTargets"

interface Props {
  id: string
  value: string
  options: readonly WebhookTargetOption[]
  placeholder: string
  onValueChange: (value: string) => void
}

export function WebhookTargetSelect({ id, value, options, placeholder, onValueChange }: Props) {
  return (
    <Select value={value || undefined} onValueChange={onValueChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
