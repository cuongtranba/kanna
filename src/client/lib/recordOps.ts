export function omitKey<V>(record: Readonly<Record<string, V>>, key: string): Record<string, V> {
  const { [key]: _omitted, ...rest } = record
  return rest
}

export function omitKeyOrEmpty<V>(
  record: Readonly<Record<string, V>>,
  key: string,
  empty: Readonly<Record<string, V>>,
): Readonly<Record<string, V>> {
  const rest = omitKey(record, key)
  return Object.keys(rest).length > 0 ? rest : empty
}

export function reconcileFlags(
  current: Readonly<Record<string, boolean>>,
  keys: readonly string[],
  absentValue: boolean,
): Readonly<Record<string, boolean>> {
  const next = Object.fromEntries(keys.map((key) => [key, current[key] ?? absentValue]))
  const unchanged = Object.keys(current).length === Object.keys(next).length
    && Object.entries(next).every(([key, value]) => current[key] === value)
  return unchanged ? current : next
}
