export const STACK_MIN_PROJECTS = 2

export const STACK_NEEDS_PROJECTS_MESSAGE = "Register a second project to create a stack"

export function canFormStack(projectCount: number): boolean {
  return projectCount >= STACK_MIN_PROJECTS
}
