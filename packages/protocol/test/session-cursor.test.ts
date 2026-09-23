import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { SessionHistoryQuery, SessionsCursor, SessionsQuery } from "../src/groups/session"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Session } from "@opencode-ai/schema/session"

describe("SessionsCursor", () => {
  test("retains activity ordering, root/archive filters and multiple project directories", async () => {
    const input = {
      directories: [AbsolutePath.make("/project"), AbsolutePath.make("/worktree")],
      roots: true,
      archived: false,
      sort: "updated" as const,
      order: "desc" as const,
      anchor: { id: Session.ID.make("ses_cursor"), time: 1234, direction: "next" as const },
    }
    expect(await Effect.runPromise(SessionsCursor.parse(SessionsCursor.make(input)))).toEqual(input)
  })

  test("decodes the HTTP query for single and multiple directories", () => {
    const decode = Schema.decodeUnknownSync(Schema.toCodecStringTree(SessionsQuery))
    for (const directories of [["/project"], ["/project", "/worktree"]]) {
      expect(decode({ directories, roots: "true", archived: "false", sort: "updated", limit: "64" })).toMatchObject({
        directories, roots: true, archived: false, sort: "updated", limit: 64,
      })
    }
    expect(decode({ directories: "/project", roots: "true" }).directories).toEqual([AbsolutePath.make("/project")])
  })
  test("round trips without Node globals", async () => {
    const input = {
      workspace: undefined,
      search: "protocol",
      order: "desc" as const,
      anchor: { id: Session.ID.make("ses_test"), time: 1, direction: "next" as const },
    }
    const cursor = SessionsCursor.make(input)

    expect(await Effect.runPromise(SessionsCursor.parse(cursor))).toEqual(input)
  })
})

describe("SessionHistoryQuery", () => {
  test("decodes numeric paging inputs", async () => {
    const query = await Effect.runPromise(Schema.decodeUnknownEffect(SessionHistoryQuery)({ after: "3", limit: "10" }))

    expect(query).toEqual({ after: 3, limit: 10 })
  })
})
