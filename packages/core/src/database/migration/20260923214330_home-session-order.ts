import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260923214330_home-session-order",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`session_home_recent_idx\` ON \`session\` (\`parent_id\`,\`time_archived\`,\`time_updated\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_directory_recent_idx\` ON \`session\` (\`directory\`,\`parent_id\`,\`time_archived\`,\`time_updated\`,\`id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
