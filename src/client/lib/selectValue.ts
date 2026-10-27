export interface PrefixedSelectValue {
  encode(id: string): string
  decode(value: string): string | null
}

export function prefixedSelectValue(prefix: string): PrefixedSelectValue {
  const lead = `${prefix}:`
  return {
    encode: (id) => `${lead}${id}`,
    decode: (value) => (value.startsWith(lead) ? value.slice(lead.length) : null),
  }
}
