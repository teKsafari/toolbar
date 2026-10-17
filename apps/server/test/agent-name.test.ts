// Agent names and marks on comments written for a person (D-207): the MCP client name cleaned
// and normalised, a monogram per agent, and mark colours that pass contrast in light and dark.
import { describe, expect, it } from 'vitest';
import { agentIdentity, agentName, authorLabel, cleanClientName, contrast, markColors } from '../src/lib/components/agent/agent-name.ts';

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
