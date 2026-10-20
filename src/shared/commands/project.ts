import { z } from "zod"
import { defineCommand, defineCommands, noParams, REMOTE_ALLOWED } from "./define"
import { projectIdParams, projectIdShape } from "./fragments"

export const projectCommands = defineCommands(
  defineCommand("project.open", {
    params: z.object({ localPath: z.string() }),
    summary: "Open an existing folder as a project, registering it if new.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.create", {
    params: z.object({ localPath: z.string(), title: z.string() }),
    summary: "Create a project directory and register it as a project.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.remove", {
    params: projectIdParams,
    summary: "Hide a project from the sidebar; reopening the folder restores it.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.delete", {
    params: projectIdParams,
    summary: "Permanently delete a project with its chats, boards, shares, worktrees and stored files.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.setStar", {
    params: z.object({ ...projectIdShape, starred: z.boolean() }),
    summary: "Star or unstar a project.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.setInstructions", {
    params: z.object({ ...projectIdShape, instructions: z.string() }),
    summary: "Set the standing instructions added to every chat in the project.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("project.readDiffPatch", {
    params: z.object({ ...projectIdShape, path: z.string(), chatId: z.string().optional() }),
    summary: "Read the git patch of one changed file in the project.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("sessions.importClaude", {
    params: noParams,
    summary: "Import all Claude Code sessions found on this machine as chats.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("sessions.importClaudeSession", {
    params: z.object({ sessionIds: z.array(z.string()) }),
    summary: "Import specific Claude Code sessions by id.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("sidebar.reorderProjectGroups", {
    params: z.object({ projectIds: z.array(z.string()) }),
    summary: "Set the sidebar order of project groups.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.create", {
    params: z.object({ title: z.string(), projectIds: z.array(z.string()), instructions: z.string().optional() }),
    summary: "Create a stack grouping several projects.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.rename", {
    params: z.object({ stackId: z.string(), title: z.string() }),
    summary: "Rename a stack.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.setInstructions", {
    params: z.object({ stackId: z.string(), instructions: z.string() }),
    summary: "Set the standing instructions for a stack.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.remove", {
    params: z.object({ stackId: z.string() }),
    summary: "Remove a stack.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.addProject", {
    params: z.object({ stackId: z.string(), ...projectIdShape }),
    summary: "Add a project to a stack.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.removeProject", {
    params: z.object({ stackId: z.string(), ...projectIdShape }),
    summary: "Remove a project from a stack.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("stack.listWorktrees", {
    params: projectIdParams,
    summary: "List the git worktrees of a project.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
)
