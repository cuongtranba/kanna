---
id: c3-121
c3-seal: aefed5af5080f9f9c1f3b3b637dcec1a12943ab549eac0f0f2f16b296f47fd69
title: stacks-ui
type: component
category: feature
parent: c3-1
goal: 'Render stacks in the sidebar: create one, edit its projects and instructions, start a chat on it, and read what is running across it.'
uses:
    - rule-colocated-bun-test
    - rule-strong-typing
    - rule-zustand-store
---

## Goal

Render stacks in the sidebar: create one, edit its projects and instructions, start a chat on it, and read what is running across it.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 Client |
| Runtime | React under the sidebar, plus a stack-scoped boards route |
| Consumers | c3-111 (sidebar shell), c3-119 (boards UI, for a stack-owned board) |
| Boundary | Renders and commands only; every stack decision is c3-238's, and the shapes are c3-313's |

## Purpose

Owns the stack surface a user actually touches — the sidebar section and its rows, the create panel, the edit panels for projects and instructions, the create-chat row, and the stack boards route — together with the command hook that sends every `stack.*` write. Non-goals: resolving bindings, composing prompts, and deciding what a stack chat can reach.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-zustand-store | rule | Panel and draft state lives in a store, never in useState | must follow | useState is banned under src/client; StackChatCreateRow.store.ts is the pattern |
| rule-colocated-bun-test | rule | Each panel has a colocated test | must follow | StacksSection.test.tsx, StackCreatePanel.test.tsx, Menus.stack.test.tsx |
| rule-strong-typing | rule | Stack shapes are imported from c3-313, never redeclared | must follow | A second declaration is a second thing to keep in step |
| adr-20260904-project-stack-instructions | adr | stack.create carries instructions rather than firing a second command | must follow | The client has no stack id before the ack |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| StacksSection | OUT | Lists each stack with its member projects and its rolled-up activity | c3-111 | src/client/components/chat-ui/sidebar/StacksSection.tsx |
| Stack create and edit panels | IN | Create a stack with its projects and instructions; rename, add or remove a project, edit instructions | c3-101 | src/client/components/chat-ui/sidebar/StackEditPanels.tsx |
| useStackCommands | IN/OUT | The one place every stack.* command is sent, extracted so useAppGlobalState does not grow | c3-102 | src/client/app/useStackCommands.ts |
| StackBoardsRoutePage | OUT | A stack's boards, reusing the board pane with a stack owner | c3-119 | src/client/app/StackBoardsRoutePage.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/components/chat-ui/sidebar/Stack*.tsx | c3-121 Contract | Layout and copy | src/client/components/chat-ui/sidebar/StacksSection.tsx |
| src/client/app/useStackCommands.ts | c3-121 Contract | Internal helper shape | src/client/app/useStackCommands.ts |
| src/client/app/StackBoardsRoutePage.tsx | c3-121 Contract | Layout and copy | src/client/app/StackBoardsRoutePage.tsx |
