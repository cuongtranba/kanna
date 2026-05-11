import { describe, test, expect, afterAll } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EventStore } from "./event-store"

const tempDirs: string[] = []
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanna-stack-test-"))
  tempDirs.push(dir)
  return dir
}

async function buildStoreWithProjects(paths: string[]): Promise<{ store: EventStore; projectIds: string[] }> {
  const store = new EventStore(await createTempDataDir())
  await store.initialize()
  const projectIds: string[] = []
  for (const p of paths) {
    const project = await store.openProject(p, p)
    projectIds.push(project.id)
  }
  return { store, projectIds }
}

describe("removeProjectFromStack", () => {
  test("removeProjectFromStack removes the project", async () => {
    const { store, projectIds: [p1, p2, p3] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2", "/tmp/p3"])
    const stack = await store.createStack("My Stack", [p1, p2, p3])
    await store.removeProjectFromStack(stack.id, p3)
    expect(store.getStack(stack.id)?.projectIds).toEqual([p1, p2])
  })

  test("removeProjectFromStack blocks dropping below 2 members", async () => {
    const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    const stack = await store.createStack("Two Members", [p1, p2])
    await expect(store.removeProjectFromStack(stack.id, p1)).rejects.toThrow(
      /Stack must keep at least 2 projects\. Delete the stack instead\./u,
    )
  })

  test("removeProjectFromStack on non-member is idempotent", async () => {
    const { store, projectIds: [p1, p2, p3] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2", "/tmp/p3"])
    const stack = await store.createStack("My Stack", [p1, p2])
    await expect(store.removeProjectFromStack(stack.id, p3)).resolves.toBeUndefined()
    expect(store.getStack(stack.id)?.projectIds).toEqual([p1, p2])
  })

  test("removeProjectFromStack on unknown stack throws", async () => {
    const { store, projectIds: [p1] } = await buildStoreWithProjects(["/tmp/p1"])
    await expect(store.removeProjectFromStack("nonexistent-id", p1)).rejects.toThrow(/Stack not found/u)
  })
})

describe("addProjectToStack", () => {
  test("addProjectToStack appends the project id", async () => {
    const { store, projectIds: [p1, p2, p3] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2", "/tmp/p3"])
    const stack = await store.createStack("My Stack", [p1, p2])
    await store.addProjectToStack(stack.id, p3)
    expect(store.getStack(stack.id)?.projectIds).toEqual([p1, p2, p3])
  })

  test("addProjectToStack on unknown stack throws", async () => {
    const { store, projectIds: [p1] } = await buildStoreWithProjects(["/tmp/p1"])
    await expect(store.addProjectToStack("nonexistent-id", p1)).rejects.toThrow(/Stack not found/u)
  })

  test("addProjectToStack with unknown project throws", async () => {
    const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    const stack = await store.createStack("My Stack", [p1, p2])
    await expect(store.addProjectToStack(stack.id, "ghost-project")).rejects.toThrow(/Project not found/u)
  })

  test("addProjectToStack with already-member project is idempotent", async () => {
    const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    const stack = await store.createStack("My Stack", [p1, p2])
    await expect(store.addProjectToStack(stack.id, p1)).resolves.toBeUndefined()
    expect(store.getStack(stack.id)?.projectIds).toEqual([p1, p2])
  })
})

describe("removeStack", () => {
  test("removeStack marks the stack deleted; getStack returns null", async () => {
    const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    const stack = await store.createStack("To Delete", [p1, p2])
    await store.removeStack(stack.id)
    expect(store.getStack(stack.id)).toBeNull()
    expect(store.listStacks()).toEqual([])
  })

  test("removeStack on unknown id throws", async () => {
    const { store } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    await expect(store.removeStack("nonexistent-id")).rejects.toThrow(/Stack not found/u)
  })

  test("removeStack on already-deleted id is idempotent (does not throw)", async () => {
    const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    const stack = await store.createStack("Twice Deleted", [p1, p2])
    await store.removeStack(stack.id)
    await expect(store.removeStack(stack.id)).resolves.toBeUndefined()
  })
})

describe("renameStack", () => {
  test("renameStack updates the title and emits stack_renamed", async () => {
    const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    const stack = await store.createStack("Original", [p1, p2])
    await store.renameStack(stack.id, "Updated")
    expect(store.getStack(stack.id)?.title).toBe("Updated")
  })

  test("renameStack on unknown id throws", async () => {
    const { store } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    await expect(store.renameStack("nonexistent-id", "New Title")).rejects.toThrow(/Stack not found/u)
  })

  test("renameStack on deleted stack throws", async () => {
    const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    const stack = await store.createStack("To Delete", [p1, p2])
    await store.removeStack(stack.id)
    await expect(store.renameStack(stack.id, "New Title")).rejects.toThrow(/Stack not found/u)
  })

  test("renameStack with empty title throws", async () => {
    const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    const stack = await store.createStack("Valid", [p1, p2])
    await expect(store.renameStack(stack.id, "  ")).rejects.toThrow(/empty/u)
  })
})

describe("createStack", () => {
  test("createStack writes a stack_added event and returns the new stack", async () => {
    const { store, projectIds: [p1, p2] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    const stack = await store.createStack("Integration", [p1, p2])
    expect(stack.id).toMatch(/[0-9a-f-]{36}/u)
    expect(stack.title).toBe("Integration")
    expect(stack.projectIds).toEqual([p1, p2])
    expect(store.getStack(stack.id)).toEqual(stack)
  })

  test("createStack rejects fewer than 2 projects", async () => {
    const { store, projectIds: [p1] } = await buildStoreWithProjects(["/tmp/p1"])
    await expect(store.createStack("Solo", [p1])).rejects.toThrow(/at least 2 projects/u)
  })

  test("createStack rejects unknown projectId", async () => {
    const { store, projectIds: [p1] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    await expect(store.createStack("X", [p1, "ghost"])).rejects.toThrow(/Project not found/u)
  })

  test("createStack rejects duplicate projectIds in the input", async () => {
    const { store, projectIds: [p1] } = await buildStoreWithProjects(["/tmp/p1", "/tmp/p2"])
    await expect(store.createStack("X", [p1, p1])).rejects.toThrow(/duplicate/u)
  })
})
