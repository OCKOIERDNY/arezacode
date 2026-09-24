export function captureAttachmentTarget<T extends { cursor: () => number | undefined }>(input: {
  capture: () => T
  editor: () => HTMLElement | undefined
  cursor: (editor: HTMLElement) => number
}) {
  const prompt = input.capture()
  const editor = input.editor()
  if (!editor) return undefined
  return { prompt, cursor: prompt.cursor() ?? input.cursor(editor) }
}
