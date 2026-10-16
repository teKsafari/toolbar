// docs/configuration.md must list every environment variable the code, the instance settings, the
// compose files and .env.example use, and nothing else (D-151). A new variable without a row fails
// here, as does a row whose variable nobody reads any more. Since D-194 it also checks the
// classification table, and that the quickstart files ask for the required values only.
import { describe, expect, it } from 'vitest';
import { INSTANCE_FIELDS } from '@toolbar/shared/api';
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
  // the variables that override a Settings > Server field: settings/index.ts reads them by spec
  for (const f of INSTANCE_FIELDS) for (const n of f.env) if (!found.has(n)) found.set(n, `packages/shared/src/api/instance-settings.ts (${f.key})`);
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

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.coolify.yml', 'docker-compose.mail.yml', 'docker-compose.whisper.yml', 'docker-compose.dev.yml'];
/** The files a deployment uses (D-194): required values and wiring only, no dev or paused switches. */
const DEPLOYED = ['docker-compose.yml', 'docker-compose.coolify.yml'];
/** Read by Docker Compose itself, not by a service (the Coolify file's whisper profile). */
const COMPOSE_OWN = ['COMPOSE_PROFILES'];
/** Coolify generates SERVICE_* values itself (docs/configuration.md, "Coolify"). */
const isCoolifyMagic = (n: string) => n.startsWith('SERVICE_');

/** Keys of the server service's environment block in one compose file. */
function serverEnvKeys(s: string): string[] {
  const start = s.indexOf('\n  server:');
  if (start < 0) return [];
  const rest = s.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:/);
  const server = next < 0 ? rest : rest.slice(0, next + 1);
  const at = server.indexOf('environment:');
  if (at < 0) return [];
  const block = server.slice(at).split(/\n {4}[a-z_]+:/)[0]!;
  return [...block.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!);
}

/** ${X} references and the server's environment keys in every compose file. */
function composeVars(): Map<string, string> {
  const found = new Map<string, string>();
  for (const f of COMPOSE_FILES) {
    const s = read(f);
    for (const m of s.matchAll(/(?<!\$)\$\{([A-Z][A-Z0-9_]*)/g)) if (!isCoolifyMagic(m[1]!)) found.set(m[1]!, f);
    for (const k of serverEnvKeys(s)) if (!isCoolifyMagic(k)) found.set(k, f);
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

/** The values a person sets to boot a server (D-194). AUTH_SECRET is BETTER_AUTH_SECRET's short name. */
const REQUIRED = ['ADMIN_EMAILS', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_ISSUER', 'PUBLIC_URL'].sort();
/** What the compose files fill in for the containers they run. */
const WIRING = ['PORT', 'DATABASE_URL', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'WHISPER_URL'];

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
    const known = new Set([...codeVars().keys(), ...composeVars().keys(), ...envExampleVars(), ...injectorVars().keys(), ...agentVars().keys(), ...COMPOSE_OWN]);
    const scripts = scriptText();
    const stale = [...names].filter((n) => !known.has(n) && !new RegExp(`\\b${n}\\b`).test(scripts));
    expect(stale).toEqual([]);
  });

  it('keeps the basic deployment to the required values (D-194)', () => {
    const required = rows.filter((r) => r.cells[3]!.startsWith('**Required')).map((r) => r.name);
    expect(required.sort()).toEqual(REQUIRED.filter((n) => n !== 'AUTH_SECRET'));
    // the Coolify file asks for exactly the values Coolify cannot generate, and passes no optional one
    const coolify = read('docker-compose.coolify.yml');
    const asked = [...coolify.matchAll(/\$\{([A-Z_]+):\?\}/g)].map((m) => m[1]).sort();
    expect(asked).toEqual(['ADMIN_EMAILS', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_ISSUER']);
    expect(coolify).not.toMatch(/\$\{[A-Z_]+:-/);
    expect(coolify).not.toMatch(/^\s+ports:/m);
    // the deployed files' server environment: required values and the stack's wiring only
    for (const f of DEPLOYED) {
      const extra = serverEnvKeys(read(f)).filter((k) => !isCoolifyMagic(k) && !REQUIRED.includes(k) && !WIRING.includes(k));
      expect(extra, f).toEqual([]);
    }
    // .env.example: the required block uncommented at the top, every other line commented
    const example = read('.env.example');
    const live = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    expect(live.sort()).toEqual(REQUIRED.filter((n) => n !== 'AUTH_SECRET'));
    expect(example.indexOf('# --- required')).toBeLessThan(example.indexOf('# --- optional overrides'));
    expect(example).toContain('docs/configuration.md');
  });

  it('keeps development, test and paused switches out of the deployed compose files (D-194)', () => {
    for (const f of DEPLOYED) {
      expect(read(f), f).not.toMatch(/AUTH_DEV_PASSWORD|AUTH_RATE_LIMIT|AUTH_MAGIC_LINK|FEATURE_[A-Z]|AI_PROVIDER|oidc-mock|OIDC_MOCK_PORT/);
    }
    expect(read('docker-compose.dev.yml')).toMatch(/^ {2}oidc-mock:$/m);
    // whisper is opt-in: an override file for compose, a profile on Coolify
    expect(read('docker-compose.yml')).not.toMatch(/^ {2}whisper:$/m);
    expect(read('docker-compose.whisper.yml')).toMatch(/^ {2}whisper:$/m);
    expect(read('docker-compose.coolify.yml')).toMatch(/^ {2}whisper:\n {4}image: .*\n {4}profiles: \[whisper\]$/m);
  });

  it('classifies every variable in "Where each setting lives" (D-194)', () => {
    const doc = read('docs/configuration.md');
    const at = doc.indexOf('## Where each setting lives');
    expect(at).toBeGreaterThan(0);
    const table = doc.slice(at, doc.indexOf('\n## ', at + 5));
    const where = new Map<string, string>();
    for (const line of table.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Setting'))) {
      const [cell, place] = line.split(/(?<!\\)\|/).slice(1, 3).map((c) => c.trim());
      for (const m of cell!.matchAll(/`([A-Z][A-Z0-9_]*)`/g)) where.set(m[1]!, place!);
    }
    expect([...names].filter((n) => !where.has(n))).toEqual([]);
    expect([...where.keys()].filter((n) => !names.has(n))).toEqual([]);
    // a variable that overrides a Settings > Server field is classified there
    const wrong = INSTANCE_FIELDS.flatMap((f) => f.env).filter((n) => !/Settings > Server/.test(where.get(n) ?? ''));
    expect(wrong).toEqual([]);
    for (const n of REQUIRED) expect(where.get(n), n).toBe('Required');
  });

  it('keeps the injector Coolify files in step with each other and the Go code (D-201)', () => {
    const inj = read('deploy/injector/docker-compose.injector.yml');
    // Coolify asks for exactly the two values it cannot know
    expect([...inj.matchAll(/\$\{([A-Z_]+):\?\}/g)].map((m) => m[1]).sort()).toEqual(['INJECTOR_SECRET', 'TOOLBAR_SERVER_URL']);
    expect(inj).toMatch(/^ {6}INJECTOR_LOOPBACK: https:\/\/coolify-proxy:443$/m);
    expect(inj).not.toMatch(/INJECTOR_UPSTREAMS?:|INJECTOR_LOOPBACK_INSECURE|^\s+ports:/m);
    expect(inj).toMatch(/aliases:\n\s+- open-toolbar-injector\n/);
    const traefik = read('deploy/injector/traefik-open-toolbar-injector.yml');
    // the router reaches the alias on the injector's default port, and checks its health route
    expect(traefik).toContain('url: http://open-toolbar-injector:8080');
    expect(read('apps/injector/main.go')).toContain('env("INJECTOR_LISTEN", ":8080")');
    expect(traefik).toContain('path: /__toolbar/health');
    // one pass value, named in the rule and set by the middleware, filled in by the owner
    const yamlLines = traefik.split('\n').filter((l) => !l.trimStart().startsWith('#'));
    expect(yamlLines.filter((l) => l.includes('REPLACE_WITH_PASS_VALUE'))).toHaveLength(2);
    expect(traefik).toContain('!Header(`X-Open-Toolbar-Pass`, `REPLACE_WITH_PASS_VALUE`)');
    expect(traefik).toContain('X-Open-Toolbar-Pass: REPLACE_WITH_PASS_VALUE');
    expect(read('apps/injector/loop.go')).toContain('const passHeader = "X-Open-Toolbar-Pass"');
    // the cookie names the rule matches are the ones the injector sets
    const cookie = read('apps/injector/cookie.go');
    expect(cookie).toContain('cookieNameSecure = "__Host-tb_review"');
    expect(cookie).toContain('cookieNamePlain  = "tb_review"');
    expect(traefik).toContain('HeaderRegexp(`Cookie`, `(^|;\\s*)(__Host-)?tb_review=`)');
    // the lab for a Coolify test needs no values
    expect(read('deploy/lab/docker-compose.lab.yml')).not.toMatch(/\$\{(?!SERVICE_)/);
  });

  it('keeps mail out of the default and Coolify compose files (docs/scope.md, D-171)', () => {
    for (const f of ['docker-compose.yml', 'docker-compose.coolify.yml']) {
      const s = read(f);
      expect(s, f).not.toMatch(/mailpit|SMTP_URL|MAIL_FROM|SMTP_PORT|MAILPIT_UI_PORT|profiles: \[mail\]/);
    }
    // the paused mail lives in the opt-in override only
    const mail = read('docker-compose.mail.yml');
    expect(mail).toMatch(/^ {2}mailpit:$/m);
    expect(mail).toContain('SMTP_URL: ${SMTP_URL:-smtp://mailpit:1025}');
  });
});
