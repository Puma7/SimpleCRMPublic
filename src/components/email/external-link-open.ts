export function openExternalUrlInBrowser(url: string, documentRef: Document = document): void {
  const link = documentRef.createElement("a")
  link.href = url
  link.target = "_blank"
  link.rel = "noopener noreferrer"
  link.style.display = "none"
  documentRef.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
  }
}
