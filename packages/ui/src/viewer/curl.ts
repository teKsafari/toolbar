// Copy as cURL (J-107). Multi-line, method, every header and the body. Secret headers that the
// capture masked (J-185) become placeholders the reader fills in; cookies always do.
import { REDACT_HEADER_RE } from '@toolbar/shared/constants';

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Placeholder text for a masked header value. */
export const placeholderFor = (name: string) => `<${name.toLowerCase()}>`;

export function toCurl(r: { method: string; url: string; requestHeaders?: Record<string, string>; requestBody?: string | null }): string {
  const lines = [`curl ${q(r.url)}`];
  if (r.method && r.method !== 'GET') lines.push(`-X ${r.method}`);
  for (const [k, v] of Object.entries(r.requestHeaders ?? {})) {
    const name = k.toLowerCase();
    if (name === 'content-length' || name === 'host') continue;
    const masked = name === 'cookie' || /\[redacted\]/i.test(v) || REDACT_HEADER_RE.test(name);
    lines.push(`-H ${q(`${k}: ${masked ? placeholderFor(k) : v}`)}`);
  }
  if (r.requestBody != null && r.requestBody !== '') lines.push(`--data-raw ${q(r.requestBody)}`);
  return lines.join(' \\\n  ');
}
