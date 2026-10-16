// docs/configuration.md must list every environment variable the code, the compose files and
// .env.example use, and nothing else (D-151). A new variable without a row fails here, as does a
// row whose variable nobody reads any more.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const SKIP_DIR = /(^|\/)(node_modules|\.output|\.wxt|\.svelte-kit|build|dist|test)(\/|$)/;
function walk(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((f) => {
    const p = join(dir, f);
    if (SKIP_DIR.test(p)) return [];
    if (statSync(join(root, p)).isDirectory()) return walk(p);
    return /\.(ts|js|mjs|svelte)$/.test(p) && !/\.test\.ts$/.test(p) ? [p] : [];
  });
}

/** Where runtime and build-time variables are read. */
const CODE = [
  ...walk('apps/server/src'),
  ...walk('apps/server/scripts'),
  'apps/server/server.js',
  'apps/server/vite.config.ts',
  'apps/server/drizzle.config.ts',
  ...walk('apps/extension/entrypoints'),
  ...walk('apps/extension/lib'),
  ...walk('apps/extension/modules'),
  ...walk('apps/extension/scripts'),
  'apps/extension/wxt.config.ts',
].filter((p) => existsSync(join(root, p)));

const NAME = '[A-Z][A-Z0-9]*_[A-Z0-9_]+|[A-Z]{3,}';

/** Variables read in code: process.env.X, process.env['X'], import.meta.env.X, env.X of an env
 * record, and a NAME string passed to a reader such as read('X') or flag('X', ...). */
function codeVars(): Map<string, string> {
  const found = new Map<string, string>();
  for (const f of CODE) {
    const s = read(f);
    if (!/process\.env|import\.meta\.env/.test(s)) continue;
    const add = (n: string | undefined) => n && !found.has(n) && found.set(n, f);
    for (const m of s.matchAll(new RegExp(`(?:process\\.env|import\\.meta\\.env)(?:\\.(${NAME})\\b|\\[\\s*['"](${NAME})['"]\\s*\\])`, 'g'))) add(m[1] ?? m[2]);
    for (const m of s.matchAll(/\benv\.([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g)) add(m[1]);
    for (const m of s.matchAll(/\b(?:read|flag|v)\(\s*['"]([A-Z][A-Z0-9]*_[A-Z0-9_]+)['"](?:\s*,\s*['"]([A-Z][A-Z0-9]*_[A-Z0-9_]+)['"])?/g)) {
      add(m[1]);
      add(m[2]);
    }
  }
  return found;
}

/** Variables the injector container (Go) reads: env("X", ...) and os.Getenv("X") (D-167). */
function injectorVars(): Map<string, string> {
  const found = new Map<string, string>();
  const dir = 'apps/injector';
  for (const f of readdirSync(join(root, dir)).filter((x) => x.endsWith('.go') && !x.endsWith('_test.go'))) {
    const s = read(`${dir}/${f}`);
    for (const m of s.matchAll(/\b(?:env|os\.Getenv|os\.LookupEnv)\(\s*"([A-Z][A-Z0-9_]*)"/g)) if (!found.has(m[1]!)) found.set(m[1]!, `${dir}/${f}`);
  }
  for (const m of read('deploy/injector/docker-compose.injector.yml').matchAll(/(?<!\$)\$\{([A-Z][A-Z0-9_]*)/g)) if (!found.has(m[1]!)) found.set(m[1]!, 'deploy/injector/docker-compose.injector.yml');
  return found;
}

/** Variables the Agent Skill tells the agent's shell to set: $TOOLBAR_* in SKILL.md and the served copy. */
function agentVars(): Map<string, string> {
  const found = new Map<string, string>();
  for (const f of ['skills/open-toolbar-feedback/SKILL.md', 'packages/shared/src/areas/handoff.ts']) {
    const s = read(f);
    for (const m of s.matchAll(/\$\{?(TOOLBAR_[A-Z0-9_]+)/g)) if (!found.has(m[1]!)) found.set(m[1]!, f);
    for (const m of s.matchAll(/(?:_ENV|ENV_[A-Z]+) = '(TOOLBAR_[A-Z0-9_]+)'/g)) if (!found.has(m[1]!)) found.set(m[1]!, f);
  }
  return found;
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.coolify.yml'];
/** Coolify generates SERVICE_* values itself (docs/configuration.md, "Coolify"). */
const isCoolifyMagic = (n: string) => n.startsWith('SERVICE_');

/** ${X} references and the server's environment keys in both compose files. */
function composeVars(): Map<string, string> {
  const found = new Map<string, string>();
  for (const f of COMPOSE_FILES) {
    const s = read(f);
    for (const m of s.matchAll(/(?<!\$)\$\{([A-Z][A-Z0-9_]*)/g)) if (!isCoolifyMagic(m[1]!)) found.set(m[1]!, f);
    // keys of the server's environment block
    const server = s.slice(s.indexOf('\n  server:'), s.indexOf('\n  postgres:'));
    const envBlock = server.slice(server.indexOf('environment:'), server.search(/\n {4}(depends_on|volumes|healthcheck|restart):/));
    for (const m of envBlock.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)) if (!isCoolifyMagic(m[1]!)) found.set(m[1]!, f);
  }
  return found;
}

/** NAME= lines of .env.example, commented ones included. */
function envExampleVars(): Set<string> {
  return new Set([...read('.env.example').matchAll(/^(?:# )?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!));
}

/** Names the release and setup scripts read (shell); used only to accept rows for them. */
function scriptText(): string {
  return readdirSync(join(root, 'scripts'))
    .filter((f) => f.endsWith('.sh'))
    .map((f) => read(`scripts/${f}`))
    .join('\n');
}

interface Row {
  name: string;
  cells: string[];
}
/** Rows of every table on docs/configuration.md whose header starts with "Variable". */
function documented(): Row[] {
  const rows: Row[] = [];
  let inTable = false;
  for (const line of read('docs/configuration.md').split('\n')) {
    if (/^\| Variable \|/.test(line)) {
      inTable = true;
      continue;
    }
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    if (!inTable || /^\|[-| ]+\|$/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    const m = /^`([A-Z][A-Z0-9_]*)`$/.exec(cells[0] ?? '');
    if (m) rows.push({ name: m[1]!, cells });
  }
  return rows;
}

describe('docs/configuration.md', () => {
  const rows = documented();
  const names = new Set(rows.map((r) => r.name));

  it('has one row per variable, each with a default, an example and a purpose', () => {
    expect(rows.length).toBeGreaterThan(50);
    const dupes = rows.map((r) => r.name).filter((n, i, a) => a.indexOf(n) !== i);
    expect(dupes).toEqual([]);
    const thin = rows.filter((r) => r.cells.length !== 4 || r.cells.slice(1).some((c) => !c)).map((r) => r.name);
    expect(thin).toEqual([]);
  });

  it('documents every variable the code reads', () => {
    const missing = [...codeVars()].filter(([n]) => !names.has(n)).map(([n, f]) => `${n} (${relative(root, join(root, f))})`);
    expect(missing).toEqual([]);
  });

  it('documents every variable the injector container and the agent side read', () => {
    const inj = injectorVars();
    expect(inj.size).toBeGreaterThan(5);
    const missing = [...inj, ...agentVars()].filter(([n]) => !names.has(n)).map(([n, f]) => `${n} (${f})`);
    expect(missing).toEqual([]);
  });

  it('documents every variable of docker-compose.yml, docker-compose.coolify.yml and .env.example', () => {
    const missing = [...composeVars()].filter(([n]) => !names.has(n)).map(([n, f]) => `${n} (${f})`);
    missing.push(...[...envExampleVars()].filter((n) => !names.has(n)).map((n) => `${n} (.env.example)`));
    expect(missing).toEqual([]);
  });

  it('lists no variable that nothing reads', () => {
    const known = new Set([...codeVars().keys(), ...composeVars().keys(), ...envExampleVars(), ...injectorVars().keys(), ...agentVars().keys()]);
    const scripts = scriptText();
    const stale = [...names].filter((n) => !known.has(n) && !new RegExp(`\\b${n}\\b`).test(scripts));
    expect(stale).toEqual([]);
  });

  it('keeps the basic deployment to the required values', () => {
    const required = rows.filter((r) => r.cells[3]!.startsWith('**Required')).map((r) => r.name);
    expect(required.sort()).toEqual(['ALLOWED_EMAIL_DOMAINS', 'BETTER_AUTH_SECRET', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_ISSUER', 'PUBLIC_URL']);
    // the Coolify file asks for exactly the values Coolify cannot generate
    const coolify = read('docker-compose.coolify.yml');
    const asked = [...coolify.matchAll(/\$\{([A-Z_]+):\?\}/g)].map((m) => m[1]).sort();
    expect(asked).toEqual(['ALLOWED_EMAIL_DOMAINS', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_ISSUER']);
    expect(coolify).not.toMatch(/^\s+ports:/m);
  });
});
