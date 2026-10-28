import type { JsonValue } from "../json"
import type { SubscriptionTopic } from "../protocol"
import { subscriptionTopicSchema } from "../protocol.schema"

export function parseSubscriptionTopic(value: JsonValue): SubscriptionTopic | null {
  const result = subscriptionTopicSchema.safeParse(value)
  return result.success ? result.data : null
}
