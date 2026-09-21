import { useI18n } from "@opencode-ai/ui/context/i18n"
import { EmptyState } from "@opencode-ai/ui/empty-state"
import { Icon } from "@opencode-ai/ui/v2/icon"
import "./session-review-v2.css"

export function SessionReviewEmptyChangesV2() {
  const i18n = useI18n()

  return (
    <EmptyState
      icon={<Icon name="review" size="large" />}
      title={i18n.t("ui.sessionReviewV2.empty.changes.title")}
      description={i18n.t("ui.sessionReviewV2.empty.changes.description")}
    />
  )
}
