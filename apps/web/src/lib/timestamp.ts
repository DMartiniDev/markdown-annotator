function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Returns a timestamp prefix in the format YYYYMMdd_HHmmss using local time.
 * Example: 20260323_150733
 *
 * @param date - Defaults to now. Pass a fixed Date in tests.
 */
export function timestampPrefix(date = new Date()): string {
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '_' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  )
}
