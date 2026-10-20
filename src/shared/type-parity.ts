import type { JsonValue } from "./json"

type Identical<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false

type Normalized<T> = Identical<T, JsonValue> extends true
  ? JsonValue
  : T extends object
    ? { -readonly [K in keyof T]: Normalized<T[K]> }
    : T

export type Parity<Schema, Declared> = Identical<Normalized<Schema>, Normalized<Declared>> extends true
  ? []
  : [schemaAndDeclaredTypeDiffer: { schema: Schema; declared: Declared }]

export function assertParity<Schema, Declared>(..._proof: Parity<Schema, Declared>): void {}
