
import type { BoardTemplateDefinition, FieldDef } from "../shared/boards/types"

export interface BuiltinBoardTemplate {
  id: string
  name: string
  description: string
  definition: BoardTemplateDefinition
}


const ASSIGNEE_FIELD: FieldDef = {
  id: "assignee",
  label: "Assignee",
  kind: "text",
  options: null,
  required: false,
}

const LABELS_FIELD: FieldDef = {
  id: "labels",
  label: "Labels",
  kind: "label",
  options: null,
  required: false,
}

const DESCRIPTION_FIELD: FieldDef = {
  id: "description",
  label: "Description",
  kind: "longtext",
  options: null,
  required: false,
}

const EXTERNAL_URL_FIELD: FieldDef = {
  id: "externalUrl",
  label: "Source",
  kind: "url",
  options: null,
  required: false,
}

const PRIORITY_FIELD: FieldDef = {
  id: "priority",
  label: "Priority",
  kind: "select",
  required: false,
  options: [
    { id: "urgent", label: "Urgent", colorToken: "destructive" },
    { id: "high", label: "High", colorToken: "warning" },
    { id: "normal", label: "Normal", colorToken: "muted-icon" },
    { id: "low", label: "Low", colorToken: "muted-icon" },
  ],
}


export const BUILTIN_BOARD_TEMPLATES: readonly BuiltinBoardTemplate[] = [
  {
    id: "builtin-dev-pipeline",
    name: "Dev pipeline",
    description: "Backlog through deployment, for work an agent picks up and carries to done.",
    definition: {
      columns: [
        { title: "Backlog", semantic: "start", colorToken: "muted-icon", wipLimit: null },
        { title: "Todo", semantic: null, colorToken: "muted-icon", wipLimit: null },
        { title: "In progress", semantic: "active", colorToken: "warning", wipLimit: 3 },
        { title: "Test", semantic: null, colorToken: "info", wipLimit: null },
        { title: "QA", semantic: "review", colorToken: "info", wipLimit: null },
        { title: "Deployment", semantic: "done", colorToken: "success", wipLimit: null },
      ],
      cardFields: [DESCRIPTION_FIELD, PRIORITY_FIELD, ASSIGNEE_FIELD, LABELS_FIELD, EXTERNAL_URL_FIELD],
      mappingDefaults: [
        { columnTitle: "Backlog", remoteKind: "state", remoteValue: "open" },
        { columnTitle: "Deployment", remoteKind: "state", remoteValue: "closed" },
      ],
    },
  },
  {
    id: "builtin-scrum",
    name: "Scrum",
    description: "Product backlog, one sprint at a time.",
    definition: {
      columns: [
        { title: "Product backlog", semantic: "start", colorToken: "muted-icon", wipLimit: null },
        { title: "Sprint backlog", semantic: null, colorToken: "muted-icon", wipLimit: null },
        { title: "In progress", semantic: "active", colorToken: "warning", wipLimit: 5 },
        { title: "Review", semantic: "review", colorToken: "info", wipLimit: null },
        { title: "Done", semantic: "done", colorToken: "success", wipLimit: null },
      ],
      cardFields: [DESCRIPTION_FIELD, PRIORITY_FIELD, ASSIGNEE_FIELD, LABELS_FIELD],
      mappingDefaults: [
        { columnTitle: "Product backlog", remoteKind: "state", remoteValue: "open" },
        { columnTitle: "Done", remoteKind: "state", remoteValue: "closed" },
      ],
    },
  },
  {
    id: "builtin-bug-triage",
    name: "Bug triage",
    description: "Reported bugs, triaged and verified before they close.",
    definition: {
      columns: [
        { title: "Reported", semantic: "start", colorToken: "destructive", wipLimit: null },
        { title: "Triaged", semantic: null, colorToken: "warning", wipLimit: null },
        { title: "Fixing", semantic: "active", colorToken: "warning", wipLimit: 3 },
        { title: "Verifying", semantic: "review", colorToken: "info", wipLimit: null },
        { title: "Closed", semantic: "done", colorToken: "success", wipLimit: null },
      ],
      cardFields: [
        DESCRIPTION_FIELD,
        PRIORITY_FIELD,
        {
          id: "severity",
          label: "Severity",
          kind: "select",
          required: false,
          options: [
            { id: "blocker", label: "Blocker", colorToken: "destructive" },
            { id: "major", label: "Major", colorToken: "warning" },
            { id: "minor", label: "Minor", colorToken: "muted-icon" },
          ],
        },
        {
          id: "reproduces",
          label: "Reproduces",
          kind: "select",
          required: false,
          options: [
            { id: "always", label: "Always", colorToken: "destructive" },
            { id: "sometimes", label: "Sometimes", colorToken: "warning" },
            { id: "unable", label: "Unable", colorToken: "muted-icon" },
          ],
        },
        LABELS_FIELD,
        EXTERNAL_URL_FIELD,
      ],
      mappingDefaults: [
        { columnTitle: "Reported", remoteKind: "state", remoteValue: "open" },
        { columnTitle: "Closed", remoteKind: "state", remoteValue: "closed" },
      ],
    },
  },
  {
    id: "builtin-github-issues",
    name: "GitHub issues",
    description: "Mirrors an issue tracker's own states, for a board that mostly follows the remote.",
    definition: {
      columns: [
        { title: "Open", semantic: "start", colorToken: "success", wipLimit: null },
        { title: "In progress", semantic: "active", colorToken: "warning", wipLimit: null },
        { title: "Closed", semantic: "done", colorToken: "muted-icon", wipLimit: null },
      ],
      cardFields: [
        DESCRIPTION_FIELD,
        ASSIGNEE_FIELD,
        LABELS_FIELD,
        { id: "milestone", label: "Milestone", kind: "text", options: null, required: false },
        EXTERNAL_URL_FIELD,
      ],
      mappingDefaults: [
        { columnTitle: "Open", remoteKind: "state", remoteValue: "open" },
        { columnTitle: "In progress", remoteKind: "label", remoteValue: "in progress" },
        { columnTitle: "Closed", remoteKind: "state", remoteValue: "closed" },
      ],
    },
  },
]

export function findBuiltinTemplate(templateId: string): BuiltinBoardTemplate | null {
  return BUILTIN_BOARD_TEMPLATES.find((template) => template.id === templateId) ?? null
}
