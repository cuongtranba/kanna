import { useShallow } from "zustand/react/shallow"

function identity<T>(value: T): T {
  return value
}

export function useShallowStable<T extends object>(value: T): T {
  return useShallow<T, T>(identity)(value)
}
