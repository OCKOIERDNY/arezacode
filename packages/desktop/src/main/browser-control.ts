import { createServer } from "node:http"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { readFileSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { app } from "electron"
import { Schema } from "effect"
import { Browser } from "@opencode-ai/core/browser"

export async function startBrowserControl(
  execute: (request: Browser.Request, signal: AbortSignal) => Promise<typeof Browser.Output.Type>,
) {
  const token = randomBytes(32).toString("hex")
  const authorization = Buffer.from(`Bearer ${token}`)
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 30000 }, async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? "")
    if (
      request.method !== "POST" ||
      request.url !== "/browser" ||
      request.headers.origin ||
      supplied.length !== authorization.length ||
      !timingSafeEqual(supplied, authorization)
    ) {
      response.writeHead(403).end("Forbidden")
      return
    }
    const controller = new AbortController()
    response.once("close", () => {
      if (!response.writableEnded) controller.abort()
    })
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > 65536) throw new Error("Browser request is too large")
        chunks.push(chunk)
      }
      const input = Schema.decodeUnknownSync(Schema.fromJsonString(Browser.Request))(
        Buffer.concat(chunks).toString("utf8"),
      )
      const result = await execute(input, AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]))
      response
        .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify(result))
    } catch (error) {
      response
        .writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" })
        .end(error instanceof Error ? error.message : "Browser request failed")
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Browser bridge failed to start")
  const data = JSON.stringify({ port: address.port, token })
  await mkdir(dirname(Browser.connectionFile), { recursive: true, mode: 0o700 })
  const temporary = `${Browser.connectionFile}.${process.pid}`
  await writeFile(temporary, data, { mode: 0o600 })
  await rename(temporary, Browser.connectionFile)
  app.once("will-quit", () => {
    server.close()
    try {
      if (readFileSync(Browser.connectionFile, "utf8") === data) rmSync(Browser.connectionFile, { force: true })
    } catch {}
  })
}
