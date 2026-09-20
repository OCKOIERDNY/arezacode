export const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  epub: "application/epub+zip",
}

export function documentType(name: string, mime?: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? ""
  if (Object.hasOwn(DOCUMENT_TYPES, extension)) return { extension, mime: DOCUMENT_TYPES[extension] }
  const entry = Object.entries(DOCUMENT_TYPES).find((entry) => entry[1] === mime?.split(";")[0])
  return entry ? { extension: entry[0], mime: entry[1] } : undefined
}
