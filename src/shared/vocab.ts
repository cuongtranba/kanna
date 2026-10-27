export function oneOf<const T extends string>(values: readonly T[]): <V>(value: V) => value is V & T {
  const known: readonly string[] = values
  return <V,>(value: V): value is V & T => typeof value === "string" && known.includes(value)
}
