export type SectionEditing<CreatePayload extends object = Record<never, never>> =
  | { kind: "list" }
  | ({ kind: "create" } & CreatePayload)
  | { kind: "edit"; id: string }

export const LIST_EDITING: { readonly kind: "list" } = { kind: "list" }
