/** "3 minutes ago" style relative time for settings lists. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 30 * 86_400) return rtf.format(-Math.round(s / 86_400), 'day');
  return new Date(iso).toLocaleDateString();
}
