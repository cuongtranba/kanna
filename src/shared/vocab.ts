function includesText(values: readonly string[], text: string): boolean {
  return values.includes(text)
}

export function oneOf<const T extends string>(values: readonly T[]): <V>(value: V) => value is V & T {
  return <V,>(value: V): value is V & T => typeof value === "string" && includesText(values, value)
}
