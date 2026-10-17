// Who wrote something on a person's behalf (D-207): the agent's display name, cleaned from the MCP
// client name (Claude Code registers as "Claude Code (open-toolbar)", Codex as "codex-mcp-client"),
// the product's logo for a known agent (D-208, agent-logos.ts), and for any other agent a two-letter
// monogram on a muted hue. Plain functions, so the unit tests need no component.
import { AGENT_LOGOS, type AgentLogoKey } from './agent-logos.ts';

export interface AgentIdentity {
  /** display name: "Claude Code", or the cleaned raw client name */
  name: string;
  /** one or two characters drawn in the mark */
  monogram: string;
  /** hue of the mark, 0 to 359 */
  hue: number;
  /** saturation step: 1 for a tinted mark, 0 for a neutral one */
  tint: 0 | 1;
  /** a known client (not a fallback) */
  known: boolean;
  /** the product's logo (known agents only); without one the mark draws the monogram */
  logo?: AgentLogoKey;
}

interface Known {
  test: RegExp;
  name: string;
  monogram: string;
  hue: number;
  tint?: 0 | 1;
  logo: AgentLogoKey;
}

// Order matters: "cursor-vscode" is Cursor, "claude-code" before plain "claude".
const KNOWN: Known[] = [
  { test: /claude[\s_-]*code/, name: 'Claude Code', monogram: 'CC', hue: 22, logo: 'claude' },
  { test: /\bcodex\b|codex[\s_-]*(mcp|cli|client)|^openai[\s_-]*codex/, name: 'Codex', monogram: 'Cx', hue: 145, logo: 'openai' },
  { test: /\bopen[\s_-]?code\b/, name: 'opencode', monogram: 'oc', hue: 250, logo: 'opencode' },
  { test: /\bcursor\b/, name: 'Cursor', monogram: 'Cu', hue: 0, tint: 0, logo: 'cursor' },
  { test: /\bwindsurf\b|\bcodeium\b/, name: 'Windsurf', monogram: 'Ws', hue: 188, logo: 'windsurf' },
  { test: /\bgemini\b/, name: 'Gemini CLI', monogram: 'Ge', hue: 280, logo: 'gemini' },
  { test: /\bvs[\s_-]?code\b|visual[\s_-]*studio[\s_-]*code/, name: 'VS Code', monogram: 'VS', hue: 210, logo: 'vscode' },
  { test: /^claude([\s_-]*(ai|desktop))?$/, name: 'Claude', monogram: 'Cl', hue: 22, logo: 'claude' },
];

// Labels the server writes when no client name is known (mcp/tools.ts, handoff/resolve.ts).
const GENERIC: Record<string, { name: string; monogram: string }> = {
  'an agent': { name: 'an agent', monogram: 'Ag' },
  'unnamed agent': { name: 'an agent', monogram: 'Ag' },
  agent: { name: 'an agent', monogram: 'Ag' },
  mcp: { name: 'an agent', monogram: 'Ag' },
  api: { name: 'API', monogram: 'AP' },
  cli: { name: 'CLI', monogram: 'CL' },
};

/**
 * Strip what an MCP client appends to its own name: a parenthesised or bracketed suffix
 * ("Claude Code (open-toolbar)", "Cursor [v1.2]"), a trailing version ("codex 0.42.1"), and
 * the "-mcp-client" or " MCP client" tail. Collapses whitespace; keeps the original case.
 */
export function cleanClientName(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) s = s.replace(/\s*[([][^()[\]]*[)\]]\s*$/, '').trim();
  s = s.replace(/\s+v?\d+(\.\d+)+\S*$/i, '').trim();
  s = s.replace(/[\s_-]+mcp([\s_-]+client)?$/i, '').trim();
  return s.slice(0, 40).trim();
}

function hashHue(s: string): number {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function monogramOf(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const w = words[0] ?? '?';
  return w.length > 1 ? w[0]!.toUpperCase() + w[1]!.toLowerCase() : w.toUpperCase();
}

/** The agent behind a client name: a known client by its usual name, else the cleaned raw name. */
export function agentIdentity(raw: string | null | undefined): AgentIdentity {
  const cleaned = cleanClientName(raw ?? '');
  const key = cleaned.toLowerCase();
  const generic = GENERIC[key] ?? (key ? null : GENERIC['an agent']!);
  if (generic) return { ...generic, hue: 0, tint: 0, known: false };
  for (const k of KNOWN) if (k.test.test(key)) return { name: k.name, monogram: k.monogram, hue: k.hue, tint: k.tint ?? 1, known: true, logo: k.logo };
  return { name: cleaned, monogram: monogramOf(cleaned), hue: hashHue(key), tint: 1, known: false };
}

/** The agent's display name alone. */
export const agentName = (raw: string | null | undefined) => agentIdentity(raw).name;

/** "Nehemia Kaaya via Claude Code": the accessible name and hover title of an author. */
export const authorLabel = (person: string, agent?: string | null) => (agent ? `${person} via ${agentName(agent)}` : person);

// ---------- colours of the mark ----------

export interface MarkColors {
  bg: string;
  fg: string;
}

const hsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${l}%)`;

/**
 * Muted fill and text of a mark: a pale tint with dark text in light, a deep tint with light text
 * in dark. Text passes 4.5:1 on its fill for every hue (unit-tested), and the fill stays quiet
 * next to the neutral surfaces of the teksafari language (colour stays out of chrome).
 */
export function markColors(id: Pick<AgentIdentity, 'hue' | 'tint'>): { light: MarkColors; dark: MarkColors } {
  const s = id.tint ? 1 : 0;
  return {
    light: { bg: hsl(id.hue, 40 * s, 91), fg: hsl(id.hue, 45 * s, 28) },
    dark: { bg: hsl(id.hue, 22 * s, 21), fg: hsl(id.hue, 50 * s, 82) },
  };
}

// ---------- colours of a logo mark ----------

/** The neutral tile a logo sits on, and the monochrome ink used where a brand colour fails. */
export const LOGO_TILE = { light: '#ffffff', dark: '#1f1f1f' } as const;
export const LOGO_MONO = { light: '#111827', dark: '#e6e6e6' } as const;
/** WCAG 1.4.11: a graphic needed to understand the content keeps 3:1 against what is next to it. */
export const LOGO_MIN_CONTRAST = 3;

export interface LogoColors {
  tile: string;
  ink: string;
  /** the brand colour is kept (else the monochrome ink) */
  brand: boolean;
}

/**
 * Ink and tile of a logo per theme: the brand colour where it keeps 3:1 against the tile, else
 * the monochrome ink (OpenAI, Cursor, Windsurf and opencode are black brands, so monochrome).
 */
export function logoColors(key: AgentLogoKey): { light: LogoColors; dark: LogoColors } {
  const hex = AGENT_LOGOS[key].hex;
  const pick = (t: 'light' | 'dark'): LogoColors => {
    const brand = contrast(hex, LOGO_TILE[t]) >= LOGO_MIN_CONTRAST;
    return { tile: LOGO_TILE[t], ink: brand ? hex : LOGO_MONO[t], brand };
  };
  return { light: pick('light'), dark: pick('dark') };
}

/** Parse "hsl(h s% l%)" to sRGB 0 to 255, for the contrast tests. */
export function hslToRgb(c: string): [number, number, number] {
  const m = /hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)/.exec(c);
  if (!m) throw new Error(`not hsl: ${c}`);
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** WCAG contrast ratio of two colours given as "hsl(...)" or "#rrggbb". */
export function contrast(a: string, b: string): number {
  const rgb = (c: string): [number, number, number] =>
    c.startsWith('#') ? [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] : hslToRgb(c);
  const lum = (c: string) => {
    const [r, g, bl] = rgb(c).map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
