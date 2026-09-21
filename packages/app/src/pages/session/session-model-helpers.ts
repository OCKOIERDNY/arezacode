import type { UserMessage } from "@opencode-ai/sdk/v2"

type Local = {
  session: {
    reset(): void
    restore(msg: UserMessage): void
  }
}

type ModelSelection = {
  model: {
    auto?(): boolean
    current(): { id: string; provider: { id: string } } | undefined
    set(model: { providerID: string; modelID: string; auto?: boolean }): void
    variant: {
      current(): string | undefined
      set(variant: string | undefined): void
    }
  }
}

type PromptState = {
  model: {
    current(): { providerID: string; modelID: string; variant?: string | null; auto?: boolean } | undefined
    set(model: { providerID: string; modelID: string; variant?: string | null; auto?: boolean }): void
  }
}

export const resetSessionModel = (local: Local) => {
  local.session.reset()
}

export const syncSessionModel = (local: Local, msg: UserMessage) => {
  local.session.restore(msg)
}

export const syncPromptModel = (local: ModelSelection, prompt: PromptState) => {
  const model = local.model.current()
  if (!model) return
  const next = {
    providerID: model.provider.id,
    modelID: model.id,
    variant: local.model.variant.current(),
    ...(local.model.auto?.() ? { auto: true } : {}),
  }
  const current = prompt.model.current()
  if (current?.providerID === next.providerID && current.modelID === next.modelID && current.variant === next.variant && Boolean(current.auto) === Boolean(next.auto))
    return
  prompt.model.set(next)
}

export const restorePromptModel = (local: ModelSelection, prompt: PromptState) => {
  const model = prompt.model.current()
  if (!model) return false
  const current = local.model.current()
  if (
    current?.provider.id === model.providerID &&
    current.id === model.modelID &&
    local.model.variant.current() === (model.variant ?? undefined) && Boolean(local.model.auto?.()) === Boolean(model.auto)
  )
    return true
  local.model.set({ providerID: model.providerID, modelID: model.modelID, ...(model.auto ? { auto: true } : {}) })
  local.model.variant.set(model.variant ?? undefined)
  return true
}
