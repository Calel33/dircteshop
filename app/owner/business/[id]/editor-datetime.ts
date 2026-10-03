/**
 * Locale-stable date formatting shared by the owner editor's status banner and
 * change history. Standalone so both presentation components reuse one formatter
 * without importing each other.
 */
export function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(timestamp);
}
