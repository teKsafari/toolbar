// Agent names and marks on comments written for a person (D-207): the MCP client name cleaned
// and normalised, a product logo per known agent (D-208), a monogram for any other, and mark
// colours that pass contrast in light and dark.
import { describe, expect, it } from 'vitest';
import { AGENT_LOGOS } from '../src/lib/components/agent/agent-logos.ts';
import { agentIdentity, agentName, authorLabel, cleanClientName, contrast, LOGO_MIN_CONTRAST, LOGO_TILE, logoColors, markColors } from '../src/lib/components/agent/agent-name.ts';

describe('agent names', () => {
  it('strips what the MCP client appends', () => {
    expect(cleanClientName('Claude Code (open-toolbar)')).toBe('Claude Code');
    expect(cleanClientName('  Cursor   [v1.2] ')).toBe('Cursor');
    expect(cleanClientName('codex-mcp-client')).toBe('codex');
    expect(cleanClientName('gemini-cli-mcp-client')).toBe('gemini-cli');
    expect(cleanClientName('Zed 0.201.3')).toBe('Zed');
    expect(cleanClientName('My Agent (team) (open-toolbar)')).toBe('My Agent');
  });

  it.each([
    ['Claude Code (open-toolbar)', 'Claude Code'],
    ['claude-code', 'Claude Code'],
    ['Claude Code', 'Claude Code'],
    ['claude-ai', 'Claude'],
    ['codex-mcp-client', 'Codex'],
    ['Codex', 'Codex'],
    ['openai-codex (open-toolbar)', 'Codex'],
    ['opencode', 'opencode'],
    ['OpenCode (open-toolbar)', 'opencode'],
    ['Cursor', 'Cursor'],
    ['cursor-vscode', 'Cursor'],
    ['Visual Studio Code', 'VS Code'],
    ['vscode (open-toolbar)', 'VS Code'],
    ['VS Code', 'VS Code'],
    ['gemini-cli-mcp-client', 'Gemini CLI'],
    ['Gemini CLI', 'Gemini CLI'],
    ['Windsurf', 'Windsurf'],
    ['windsurf-client (open-toolbar)', 'Windsurf'],
  ])('%s is %s', (raw, name) => {
    expect(agentName(raw)).toBe(name);
    expect(agentIdentity(raw).known).toBe(true);
  });

  it('falls back to the raw client name, cleaned', () => {
    expect(agentIdentity('Zed (open-toolbar)')).toMatchObject({ name: 'Zed', monogram: 'Ze', known: false });
    expect(agentIdentity('Acme Review Bot')).toMatchObject({ name: 'Acme Review Bot', monogram: 'AR', known: false });
    expect(agentName('  ')).toBe('an agent');
    expect(agentName(null)).toBe('an agent');
    expect(agentName('an agent')).toBe('an agent');
    expect(agentName('Unnamed agent')).toBe('an agent');
    expect(agentName('MCP')).toBe('an agent');
    expect(agentName('API')).toBe('API');
  });

  it('labels the author for screen readers and the hover title', () => {
    expect(authorLabel('Nehemia Kaaya', 'Claude Code (open-toolbar)')).toBe('Nehemia Kaaya via Claude Code');
    expect(authorLabel('Nehemia Kaaya', null)).toBe('Nehemia Kaaya');
  });

  it('gives each known agent its own monogram', () => {
    const marks = ['claude-code', 'codex', 'opencode', 'cursor', 'vscode', 'gemini', 'windsurf'].map((n) => agentIdentity(n).monogram);
    expect(new Set(marks).size).toBe(marks.length);
    expect(marks.every((m) => m.length === 2)).toBe(true);
  });
});

describe('mark colours', () => {
  const LIGHT_SURFACE = '#ffffff';
  const DARK_SURFACE = '#131313';
  it('text passes 4.5:1 on the fill for every hue, tinted or neutral, in light and dark', () => {
    for (let hue = 0; hue < 360; hue += 5)
      for (const tint of [0, 1] as const) {
        const c = markColors({ hue, tint });
        expect(contrast(c.light.fg, c.light.bg), `light ${hue}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.dark.fg, c.dark.bg), `dark ${hue}`).toBeGreaterThanOrEqual(4.5);
      }
  });

  it('the fill stays quiet: close to the surface it sits on', () => {
    for (const raw of ['claude-code', 'codex', 'opencode', 'cursor', 'vscode', 'gemini', 'windsurf']) {
      const c = markColors(agentIdentity(raw));
      expect(contrast(c.light.bg, LIGHT_SURFACE), raw).toBeLessThan(1.4);
      expect(contrast(c.dark.bg, DARK_SURFACE), raw).toBeLessThan(1.8);
    }
  });
});

describe('logos (D-208)', () => {
  it.each([
    ['Claude Code (open-toolbar)', 'claude'],
    ['claude-ai', 'claude'],
    ['codex-mcp-client', 'openai'],
    ['opencode', 'opencode'],
    ['Cursor', 'cursor'],
    ['vscode', 'vscode'],
    ['gemini-cli-mcp-client', 'gemini'],
    ['Windsurf', 'windsurf'],
  ])('%s shows the %s logo', (raw, logo) => {
    expect(agentIdentity(raw).logo).toBe(logo);
    expect(AGENT_LOGOS[logo as keyof typeof AGENT_LOGOS].path.length).toBeGreaterThan(20);
  });

  it('unknown agents and the server labels keep the monogram', () => {
    for (const raw of ['Zed (open-toolbar)', 'Acme Review Bot', 'an agent', 'API', null]) {
      const id = agentIdentity(raw);
      expect(id.logo, String(raw)).toBeUndefined();
      expect(id.monogram.length).toBeGreaterThan(0);
    }
  });

  it('every logo keeps 3:1 against its tile in light and dark', () => {
    for (const key of Object.keys(AGENT_LOGOS) as (keyof typeof AGENT_LOGOS)[]) {
      const c = logoColors(key);
      expect(contrast(c.light.ink, c.light.tile), `light ${key}`).toBeGreaterThanOrEqual(LOGO_MIN_CONTRAST);
      expect(contrast(c.dark.ink, c.dark.tile), `dark ${key}`).toBeGreaterThanOrEqual(LOGO_MIN_CONTRAST);
    }
  });

  it('keeps the brand colour where it passes and goes monochrome where it fails', () => {
    expect(logoColors('claude').light).toMatchObject({ ink: '#D97757', brand: true });
    expect(logoColors('claude').dark).toMatchObject({ ink: '#D97757', brand: true });
    expect(logoColors('vscode').dark.brand).toBe(true);
    expect(logoColors('gemini').light.brand).toBe(true);
    // black brands disappear on the dark tile: monochrome there
    for (const key of ['openai', 'cursor', 'windsurf', 'opencode'] as const) expect(logoColors(key).dark.brand, key).toBe(false);
    expect(LOGO_TILE.light).toBe('#ffffff');
  });
});
