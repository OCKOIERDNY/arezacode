import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"

export function SessionContextHelp(props: { label: string; text: string }) {
  return (
    <Tooltip value={props.text} contentClass="max-w-72 whitespace-normal" placement="top">
      <button type="button" aria-label={props.label} class="inline-flex size-6 shrink-0 items-center justify-center rounded text-text-weaker hover:text-text-base focus-visible:outline focus-visible:outline-2">
        <Icon name="help" size="small" />
      </button>
    </Tooltip>
  )
}
