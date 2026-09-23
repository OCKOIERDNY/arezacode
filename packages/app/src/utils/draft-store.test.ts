import { expect, test } from "bun:test"
import { createDraftStore } from "./draft-store"

test("restores queued image bytes from durable references without persisting object URLs", async () => {
  const documents = new Map<string, string>()
  const blobs = new Map<string, Blob>()
  const restoredIDs: string[] = []
  const driver = {
    get: async (key: string) => documents.get(key) ?? null,
    set: async (key: string, value: string) => {
      documents.set(key, value)
    },
    remove: async (key: string) => {
      documents.delete(key)
    },
    putBlob: async (blob: Blob) => {
      blobs.set("image", blob)
      return "image"
    },
    getBlob: async (id: string) => {
      restoredIDs.push(id)
      return blobs.get(id) ?? null
    },
  }
  const store = createDraftStore(driver)
  const blob = await store.putBlob(new Blob(["image bytes"], { type: "image/png" }))
  await store.setItem("queue", JSON.stringify({ items: { session: [{ prompt: [{ type: "image", blob }] }] } }))
  expect(documents.get("queue")).not.toContain("blob:")
  const restored = JSON.parse((await createDraftStore(driver).getItem("queue")) ?? "null")
  expect(restored.items.session[0].prompt[0].blob.id).toBe("image")
  expect(restored.items.session[0].prompt[0].blob.url).toStartWith("blob:")
  expect(restoredIDs).toEqual(["image"])
  expect(await blobs.get("image")?.text()).toBe("image bytes")
})
