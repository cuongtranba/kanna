import type { StackSummary } from "../../../../shared/types"

export function stackMembers<P extends { id: string }>(
  stack: Pick<StackSummary, "projectIds">,
  projects: readonly P[],
): P[] {
  return projects.filter((project) => stack.projectIds.includes(project.id))
}
