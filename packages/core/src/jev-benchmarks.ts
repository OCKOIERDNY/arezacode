export * as JevBenchmarks from "./jev-benchmarks"

const models = {
  "gpt-6-luna": { intelligence: 37, outputTokensMillions: 150, costPerTaskUSD: 0.07, inputUSDPerMillion: 0.1, outputUSDPerMillion: 0.5, outputTokensPerSecond: 141.4, firstTokenSeconds: 106.86 },
  "gpt-6-sol": { intelligence: 48, outputTokensMillions: 77, costPerTaskUSD: 1.06, inputUSDPerMillion: 2, outputUSDPerMillion: 10, outputTokensPerSecond: 115.9, firstTokenSeconds: 136.12 },
  "gpt-6-astra": { intelligence: 53, outputTokensMillions: 60, costPerTaskUSD: 3.26, inputUSDPerMillion: 10, outputUSDPerMillion: 50, outputTokensPerSecond: 52.5, firstTokenSeconds: 352.15 },
}

export function evidence(providerID: string, modelID: string) {
  const id = providerID === "openrouter" ? modelID.replace(/^openai\//, "") : modelID
  if (providerID !== "openai" && !(providerID === "openrouter" && modelID.startsWith("openai/"))) return undefined
  const model = Object.entries(models).find(([key]) => key === id)?.[1]
  if (!model) return undefined
  return {
    source: `https://artificialanalysis.ai/models/${id}`,
    observedAt: "2026-09-24",
    suite: "Artificial Analysis Intelligence Index v4.3.2",
    effort: "max",
    scope: "Published aggregate benchmark, not local task-type or low-effort measurements; output tokens cover the full index, cost is per weighted task. Catalog pricing takes precedence for this provider.",
    ...model,
  }
}
