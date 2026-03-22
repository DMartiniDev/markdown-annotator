/**
 * Downloads a string as a file via a synthetic anchor click.
 * Always revokes the blob URL after triggering the download to prevent
 * memory accumulation across multiple export calls.
 */
export function downloadFile(data: string, filename: string, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // Must append to DOM for Firefox compatibility
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke after a tick — the download dialog must be triggered first
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

export function downloadJson(data: unknown, filename: string): void {
  downloadFile(JSON.stringify(data, null, 2), filename, 'application/json')
}

export function downloadText(data: string, filename: string): void {
  downloadFile(data, filename, 'text/plain')
}
