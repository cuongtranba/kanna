import { z } from "zod"
import { defineCommand, defineCommands, noParams, noResult, REMOTE_ALLOWED } from "./define"
import { projectIdParams, projectIdShape } from "./fragments"
import { diffPatchResultSchema } from "../git-diff-types.schema"
import {
  importClaudeSessionsResultSchema,
  importSessionsByIdsResultSchema,
  projectDeleteResultSchema,
  projectIdResultSchema,
  stackIdResultSchema,
  stackWorktreesResultSchema,
} from "./results/project"

export const projectCommands = defineCommands(
  defineCommand("project.open", {
    result: projectIdResultSchema,
    params: z.object({ localPath: z.string().describe("Absolute path of the folder on the machine running Kanna") }),
    summary: "Open an existing folder as a project, registering it if new.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.create", {
    result: projectIdResultSchema,
    params: z.object({
      localPath: z.string().describe("Absolute path of the folder to create"),
      title: z.string().describe("Display title of the project"),
    }),
    summary: "Create a project directory and register it as a project.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.remove", {
    result: noResult,
    params: projectIdParams,
    summary: "Hide a project from the sidebar; reopening the folder restores it.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.delete", {
    result: projectDeleteResultSchema,
    params: projectIdParams,
    summary: "Permanently delete a project with its chats, boards, shares, worktrees and stored files.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.setStar", {
    result: noResult,
    params: z.object({ ...projectIdShape, starred: z.boolean() }),
    summary: "Star or unstar a project.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.setInstructions", {
    result: noResult,
    params: z.object({ ...projectIdShape, instructions: z.string() }),
    summary: "Set the standing instructions added to every chat in the project.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.readDiffPatch", {
    params: z.object({ ...projectIdShape, path: z.string(), chatId: z.string().optional() }),
    result: diffPatchResultSchema,
    summary: "Read the git patch of one changed file in the project.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("sessions.importClaude", {
    result: importClaudeSessionsResultSchema,
    params: noParams,
    summary: "Import all Claude Code sessions found on this machine as chats.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("sessions.importClaudeSession", {
    result: importSessionsByIdsResultSchema,
    params: z.object({ sessionIds: z.array(z.string()) }),
    summary: "Import specific Claude Code sessions by id.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("sidebar.reorderProjectGroups", {
    result: noResult,
    params: z.object({ projectIds: z.array(z.string()) }),
    summary: "Set the sidebar order of project groups.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.create", {
    result: stackIdResultSchema,
    params: z.object({ title: z.string(), projectIds: z.array(z.string()), instructions: z.string().optional() }),
    summary: "Create a stack grouping several projects.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.rename", {
    result: noResult,
    params: z.object({ stackId: z.string(), title: z.string() }),
    summary: "Rename a stack.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.setInstructions", {
    result: noResult,
    params: z.object({ stackId: z.string(), instructions: z.string() }),
    summary: "Set the standing instructions for a stack.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.remove", {
    result: noResult,
    params: z.object({ stackId: z.string() }),
    summary: "Remove a stack.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.addProject", {
    result: noResult,
    params: z.object({ stackId: z.string(), ...projectIdShape }),
    summary: "Add a project to a stack.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.removeProject", {
    result: noResult,
    params: z.object({ stackId: z.string(), ...projectIdShape }),
    summary: "Remove a project from a stack.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.listWorktrees", {
    result: stackWorktreesResultSchema,
    params: projectIdParams,
    summary: "List the git worktrees of a project.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
)
