import { Effect } from "effect"
import { Browser } from "@opencode-ai/core/browser"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import { Tool } from "./tool"

export const BrowserTool = Tool.define(
  "browser",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return {
      description: Browser.description,
      parameters: Browser.Input,
      execute: (input: Browser.Input, context: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          yield* context.ask({
            permission: "browser",
            patterns: [input.action === "open" ? input.url! : input.action],
            always: ["*"],
            metadata: { action: input.action },
          })
          let session = yield* sessions.get(context.sessionID).pipe(Effect.orDie)
          while (session.parentID) session = yield* sessions.get(session.parentID).pipe(Effect.orDie)
          const output = yield* Effect.promise(() =>
            Browser.execute({ sessionID: session.id, directory: instance.directory, input }, context.abort),
          )
          return {
            title: output.title || "Browser",
            output: `${output.url}\n${output.text}`,
            metadata: { url: output.url, action: input.action },
            attachments: output.image
              ? [
                  {
                    type: "file" as const,
                    mime: "image/png",
                    url: `data:image/png;base64,${output.image}`,
                    filename: "browser.png",
                  },
                ]
              : undefined,
          }
        }),
    }
  }),
)
