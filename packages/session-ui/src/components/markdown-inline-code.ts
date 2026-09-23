import { inlineCodeKind } from "./markdown-inline-code-kind"

export function markInlineCode(root: HTMLDivElement) {
  for (const code of root.querySelectorAll(":not(pre) > code")) {
    if (!(code instanceof HTMLElement)) continue
    delete code.dataset.inlineCodeKind
    const text = code.textContent ?? ""
    const kind = inlineCodeKind(text)
    if (kind) code.dataset.inlineCodeKind = kind
    if (kind !== "path" || code.closest("a") || code.closest("pre")) continue

    const link = document.createElement("a")
    link.setAttribute(
      "href",
      text
        .replace(/\\/g, "/")
        .split("/")
        .map((segment, index) => (index === 0 && /^[a-z]:$/i.test(segment) ? segment : encodeURIComponent(segment)))
        .join("/"),
    )
    link.className = "file-link"
    code.replaceWith(link)
    link.appendChild(code)
  }
}
