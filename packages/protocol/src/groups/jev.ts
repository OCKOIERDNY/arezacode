import { Jev } from "@opencode-ai/schema/jev"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const JevGroup = HttpApiGroup.make("server.jev")
  .add(
    HttpApiEndpoint.get("jev.get", "/api/jev", { query: LocationQuery, success: Jev.Status })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.jev.get", summary: "Get Jev settings" })),
  )
  .add(
    HttpApiEndpoint.patch("jev.update", "/api/jev", { query: LocationQuery, payload: Jev.Update, success: Jev.Status })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.jev.update", summary: "Update Jev settings" })),
  )
  .add(
    HttpApiEndpoint.post("jev.prepare", "/api/jev/prepare", {
      query: LocationQuery,
      payload: Jev.Prepare,
      success: Jev.Prepared,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.jev.prepare", summary: "Prepare a prompt with Jev" })),
  )
