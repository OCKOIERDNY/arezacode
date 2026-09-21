export * as BrowserTool from "./browser"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer } from "effect"
import { Browser } from "../browser"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { SessionStore } from "../session/store"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const location = yield* Location.Service
    const sessions = yield* SessionStore.Service
    yield* tools
      .register({
        browser: Tool.make({
          description: Browser.description,
          input: Browser.Input,
          output: Browser.Output,
          toModelOutput: ({ output }) => [
            { type: "text", text: `${output.title}\n${output.url}\n${output.text}` },
            ...(output.image
              ? [{ type: "file" as const, data: output.image, mime: "image/png", name: "browser.png" }]
              : []),
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "browser",
                resources: [input.action === "open" ? input.url! : input.action],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              let session = yield* sessions.get(context.sessionID)
              while (session?.parentID) session = yield* sessions.get(session.parentID)
              return yield* Effect.tryPromise({
                try: (signal) =>
                  Browser.execute(
                    { sessionID: session?.id ?? context.sessionID, directory: location.directory, input },
                    signal,
                  ),
                catch: (error) =>
                  new ToolFailure({ message: error instanceof Error ? error.message : "Browser request failed" }),
              })
            }).pipe(
              Effect.mapError(
                (error) =>
                  new ToolFailure({ message: error instanceof Error ? error.message : "Browser request failed" }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/browser",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, Location.node, SessionStore.node],
})
