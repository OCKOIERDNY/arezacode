import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260924195000_durable_session_tasks",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run("ALTER TABLE session_input ADD COLUMN preparation text")
      yield* tx.run(`
        CREATE TABLE session_task (
          session_id text PRIMARY KEY NOT NULL REFERENCES session(id) ON DELETE CASCADE,
          parent_id text NOT NULL REFERENCES session(id) ON DELETE CASCADE,
          context_id text,
          input_id text NOT NULL,
          status text NOT NULL,
          attempt integer DEFAULT 0 NOT NULL,
          owner text,
          output text,
          error text,
          result_input_id text UNIQUE,
          time_created integer NOT NULL,
          time_updated integer NOT NULL,
          time_completed integer
        )
      `)
      yield* tx.run("CREATE INDEX session_task_parent_status_idx ON session_task(parent_id, status)")
      yield* tx.run("CREATE INDEX session_task_owner_status_idx ON session_task(owner, status)")
    })
  },
} satisfies DatabaseMigration.Migration
