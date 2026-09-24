import { expect, test } from "bun:test"
import { normalizeLocale } from "../context/language"
import { DESKTOP_NATIVE_ENGLISH, DESKTOP_NATIVE_LOCALES } from "./desktop-native"
import { dict } from "./en"
import { UI_PLURAL_KEYS } from "@opencode-ai/ui/context/i18n"

test("English is the only supported locale and old preferences normalize to English", () => {
  expect(DESKTOP_NATIVE_LOCALES).toEqual(["en"])
  for (const locale of ["en", "ru", "ar", "pa", "zh", "invalid"]) {
    expect(normalizeLocale(locale)).toBe("en")
  }
})

test("English app messages retain the native bundle placeholders", () => {
  const messages: Record<string, string> = dict
  for (const [key, value] of Object.entries(DESKTOP_NATIVE_ENGLISH)) {
    const message = messages[key]
    expect(message).toBeDefined()
    expect(message.match(/{{[^}]+}}/g)?.sort() ?? []).toEqual(value.match(/{{[^}]+}}/g)?.sort() ?? [])
  }
})

test("English plural families have nonempty singular and plural messages", async () => {
  const ui = await import("@opencode-ai/ui/i18n/en")
  for (const [source, keys] of [[dict, ["session.question.pending", "session.followupDock.summary", "session.revertDock.summary"]], [ui.dict, UI_PLURAL_KEYS]] as const) {
    const messages: Record<string, string> = source
    for (const key of keys) {
      expect(messages[`${key}.one`]?.trim()).toBeTruthy()
      expect(messages[`${key}.other`]?.trim()).toBeTruthy()
    }
  }
})
