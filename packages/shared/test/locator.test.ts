import { describe, expect, it } from 'vitest';
import {
  candidateRouteFiles,
  compileRouteId,
  guessRouteIds,
  kitBaseFromEntry,
  KIT_ENTRY_PATTERN,
  locatorFileName,
  locatorFiles,
  matchRoutes,
  parseRouteDictionary,
  parseStack,
  projectPath,
  routeIdOfFile,
  stripBase,
} from '../src/locator.ts';
import { locatorPacketSchema } from '../src/schemas.ts';
import { createStackMapper, sourceMapUrlOf } from '../src/sourcemap.ts';

const PROD = `import{t as e}from"../chunks/x.js";var t={},n=[()=>e(()=>import(\`../nodes/0.js\`))],r=[],i={"/":[2],"/canvas":[3],"/(app)/c/[id]":[-5,[0,2],[1]],"/docs/[...path]":[6],"/slow":[-9]},a={handleError:(({kind:e})=>{})}`;
const DEV = `export const server_loads = [];

export const dictionary = {
		"/": [2],
		"/form": [~5],
		"/items/[id]": [~6],
		"/list": [7]
	};

export const hooks = {};`;

describe('SvelteKit route dictionary', () => {
  it('reads the minified production table, server loads included', () => {
    expect(parseRouteDictionary(PROD)).toEqual([
      { id: '/', serverLoad: false },
      { id: '/canvas', serverLoad: false },
      { id: '/(app)/c/[id]', serverLoad: true },
      { id: '/docs/[...path]', serverLoad: false },
      { id: '/slow', serverLoad: true },
    ]);
  });

  it('reads the dev table with ~n server loads', () => {
    expect(parseRouteDictionary(DEV)?.map((r) => `${r.id}${r.serverLoad ? '*' : ''}`)).toEqual(['/', '/form*', '/items/[id]*', '/list']);
  });

  it('returns null for code without a table', () => {
    expect(parseRouteDictionary('const a = {"x": [1]}; export default 1')).toBeNull();
  });

  it('finds entry URLs and the base path', () => {
    expect(KIT_ENTRY_PATTERN.test('http://h/_app/immutable/entry/app.70RGvCJo.js')).toBe(true);
    expect(KIT_ENTRY_PATTERN.test('http://h/@fs/home/x/lab/.svelte-kit/generated/dev/client/app.js')).toBe(true);
    expect(KIT_ENTRY_PATTERN.test('http://h/_app/immutable/chunks/app.js')).toBe(false);
    expect(kitBaseFromEntry('http://h/docs/_app/immutable/entry/app.x.js')).toBe('/docs');
    expect(kitBaseFromEntry('http://h/_app/immutable/entry/app.x.js')).toBe('');
    expect(stripBase('/docs/a/b', '/docs')).toBe('/a/b');
    expect(stripBase('/docs', '/docs')).toBe('/');
  });
});

describe('route matching', () => {
  const ids = ['/', '/(app)/c/[id]', '/(app)/c/new', '/docs/[...path]', '/[[lang]]/about', '/u/[name]-[n=int]'];

  it('prefers static routes, drops groups, fills params', () => {
    expect(matchRoutes('/c/new', ids).map((m) => m.id)).toEqual(['/(app)/c/new', '/(app)/c/[id]']);
    expect(matchRoutes('/c/0193abcd', ids)[0]).toMatchObject({ id: '/(app)/c/[id]', params: { id: '0193abcd' } });
    expect(matchRoutes('/docs/a/b/c', ids)[0]).toMatchObject({ id: '/docs/[...path]', params: { path: 'a/b/c' } });
    expect(matchRoutes('/sw/about', ids)[0]).toMatchObject({ id: '/[[lang]]/about', params: { lang: 'sw' } });
    expect(matchRoutes('/about', ids)[0]?.id).toBe('/[[lang]]/about');
    expect(matchRoutes('/u/ana-42', ids)[0]).toMatchObject({ params: { name: 'ana', n: '42' } });
    expect(matchRoutes('/', ids)[0]?.id).toBe('/');
    expect(compileRouteId('/').re.test('/')).toBe(true);
  });

  it('guesses params from id-looking segments', () => {
    expect(guessRouteIds('/lessons/42/steps/3')).toEqual([
      { id: '/lessons/[lessonId]/steps/[stepId]', params: { lessonId: '42', stepId: '3' } },
      { id: '/lessons/42/steps/3', params: {} },
    ]);
    expect(guessRouteIds('/c/0193f4c2-8a1b-7c3d-9e4f-0123456789ab')[0]?.id).toBe('/c/[id]');
    expect(guessRouteIds('/settings/profile')).toEqual([{ id: '/settings/profile', params: {} }]);
  });

  it('maps route files to ids', () => {
    expect(routeIdOfFile('src/routes/(app)/c/[id]/+page.svelte')).toBe('/(app)/c/[id]');
    expect(routeIdOfFile('src/routes/+page.svelte')).toBe('/');
    expect(routeIdOfFile('src/lib/Card.svelte')).toBeNull();
  });
});

describe('candidate route files', () => {
  it('uses the route table when it has one', () => {
    const { files, routeId } = candidateRouteFiles({ pathname: '/c/abc123', routes: parseRouteDictionary(PROD) });
    expect(routeId).toBe('/(app)/c/[id]');
    expect(files).toEqual([
      { file: 'src/routes/(app)/c/[id]/+page.svelte', routeId: '/(app)/c/[id]', role: 'page', source: 'manifest', params: { id: 'abc123' } },
      { file: 'src/routes/(app)/c/[id]/+page.server.ts', routeId: '/(app)/c/[id]', role: 'page-server', source: 'manifest', params: { id: 'abc123' } },
    ]);
  });

  it('puts Svelte dev files first', () => {
    const { files, routeId } = candidateRouteFiles({
      pathname: '/form',
      routes: parseRouteDictionary(DEV),
      svelteFiles: ['src/lib/Field.svelte', 'src/routes/form/+page.svelte'],
    });
    expect(routeId).toBe('/form');
    expect(files.map((f) => `${f.source}:${f.file}`)).toEqual([
      'svelte-meta:src/routes/form/+page.svelte',
      'svelte-meta:src/lib/Field.svelte',
      'manifest:src/routes/form/+page.server.ts',
    ]);
  });

  it('falls back to guesses without a table', () => {
    const { files } = candidateRouteFiles({ pathname: '/app/lessons/12', base: '/app' });
    expect(files.map((f) => f.file)).toEqual(['src/routes/lessons/[lessonId]/+page.svelte', 'src/routes/lessons/12/+page.svelte']);
    expect(files.every((f) => f.source === 'guess')).toBe(true);
  });
});

describe('stacks', () => {
  it('parses V8 and Firefox frames', () => {
    const v8 = `TypeError: Cannot read properties of undefined (reading 'name')
    at showProfile (http://localhost:5173/_app/immutable/nodes/2.js:1:2345)
    at HTMLButtonElement.<anonymous> (http://localhost:5173/_app/immutable/chunks/x.js:3:10)
    at http://localhost:5173/_app/immutable/chunks/y.js:9:8
    at async load (http://localhost:5173/src/routes/+page.ts?t=1:4:5)`;
    expect(parseStack(v8)).toEqual([
      { fn: 'showProfile', url: 'http://localhost:5173/_app/immutable/nodes/2.js', line: 1, col: 2345 },
      { fn: 'HTMLButtonElement.<anonymous>', url: 'http://localhost:5173/_app/immutable/chunks/x.js', line: 3, col: 10 },
      { url: 'http://localhost:5173/_app/immutable/chunks/y.js', line: 9, col: 8 },
      { fn: 'async load', url: 'http://localhost:5173/src/routes/+page.ts?t=1', line: 4, col: 5 },
    ]);
    expect(parseStack('showProfile@http://h/a.js:1:20\n@http://h/b.js:2:3')).toEqual([
      { fn: 'showProfile', url: 'http://h/a.js', line: 1, col: 20 },
      { url: 'http://h/b.js', line: 2, col: 3 },
    ]);
  });

  it('makes source paths project relative', () => {
    expect(projectPath('../../../../src/routes/+page.svelte')).toBe('src/routes/+page.svelte');
    expect(projectPath('webpack://app/./src/lib/x.ts')).toBe('src/lib/x.ts');
    expect(projectPath('http://localhost:5173/src/routes/+page.svelte?t=1')).toBe('src/routes/+page.svelte');
    expect(projectPath('/@fs/home/me/app/src/lib/a.ts')).toBe('src/lib/a.ts');
    expect(projectPath('../node_modules/svelte/src/internal/x.js')).toBe('node_modules/svelte/src/internal/x.js');
  });
});

describe('source maps', () => {
  // gen line 1 col 0 -> source 0, line 3 (0-based 2), col 2
  const map = { version: 3, sources: ['../../../src/lib/profile.ts'], sourcesContent: ['// a\n// b\n  throw new TypeError(user.name);\n'], names: [], mappings: 'AAEE' };
  const files: Record<string, { text: string; headers?: Record<string, string> }> = {
    'http://h/_app/a.js': { text: 'function f(){throw new TypeError("x")}\n//# sourceMappingURL=a.js.map' },
    'http://h/_app/a.js.map': { text: JSON.stringify(map) },
    'http://h/_app/b.js': { text: 'function g(){}', headers: { sourcemap: 'maps/b.map' } },
    'http://h/_app/maps/b.map': { text: JSON.stringify(map) },
    'http://h/_app/c.js': { text: `x()\n//# sourceMappingURL=data:application/json;base64,${btoa(JSON.stringify(map))}` },
    'http://h/_app/nomap.js': { text: 'x()' },
  };
  const fetched: string[] = [];
  const mapper = createStackMapper({
    fetchText: async (url) => {
      fetched.push(url);
      return files[url] ?? null;
    },
  });

  it('finds the map by comment, header or data URL', () => {
    expect(sourceMapUrlOf('http://h/_app/a.js', files['http://h/_app/a.js']!)).toBe('http://h/_app/a.js.map');
    expect(sourceMapUrlOf('http://h/_app/b.js', files['http://h/_app/b.js']!)).toBe('http://h/_app/maps/b.map');
    expect(sourceMapUrlOf('http://h/_app/nomap.js', files['http://h/_app/nomap.js']!)).toBeNull();
  });

  it('maps frames to the original file, line and source text, reading each script once', async () => {
    const stack = 'TypeError: x\n    at f (http://h/_app/a.js:1:15)\n    at http://h/_app/c.js:1:1\n    at h (http://h/_app/nomap.js:1:1)\n    at f (http://h/_app/a.js:1:20)';
    const r = await mapper.mapStack(stack);
    expect(r.mapped).toBe(true);
    expect(r.frames[0]).toMatchObject({ fn: 'f', url: 'http://h/_app/a.js', line: 1, col: 15, file: 'src/lib/profile.ts', srcLine: 3, srcCol: 3, snippet: 'throw new TypeError(user.name);' });
    expect(r.frames[1]).toMatchObject({ file: 'src/lib/profile.ts', srcLine: 3 });
    expect(r.frames[2]).toEqual({ fn: 'h', url: 'http://h/_app/nomap.js', line: 1, col: 1 });
    expect(fetched.filter((u) => u === 'http://h/_app/a.js')).toHaveLength(1);
  });

  it('says why nothing mapped', async () => {
    expect(await mapper.mapStack('Error\n    at http://h/_app/nomap.js:1:1')).toMatchObject({ mapped: false, reason: 'no_map' });
    expect(await mapper.mapStack('Error\n    at http://h/_app/gone.js:1:1')).toMatchObject({ mapped: false, reason: 'fetch_failed' });
    expect(await mapper.mapStack(undefined)).toMatchObject({ mapped: false, reason: 'no_stack' });
  });
});

describe('packet', () => {
  it('validates a minimal packet and names its file', () => {
    const p = { v: 1, kind: 'element', at: 1, url: 'http://h/', route: '/', routeFiles: [], viewport: { w: 1, h: 1, scrollX: 0, scrollY: 0, dpr: 1 } };
    expect(locatorPacketSchema.parse(p)).toEqual(p);
    expect(locatorFileName(1)).toBe('a01.locator.json');
    expect(locatorFileName(12)).toBe('a12.locator.json');
  });

  it('names folder files after the annotation order', () => {
    const p = { v: 1 as const, kind: 'element' as const, at: 1, url: 'http://h/', route: '/', routeFiles: [], viewport: { w: 1, h: 1, scrollX: 0, scrollY: 0, dpr: 1 } };
    const files = locatorFiles([{ locator: { ...p, crop: { w: 10, h: 5, scale: 1, assetId: 'x' } } }, {}, { locator: p }]);
    expect(files.map((f) => f.path)).toEqual(['annotations/a01.locator.json', 'annotations/a03.locator.json']);
    expect(files[0]!.packet.crop).toEqual({ w: 10, h: 5, scale: 1, assetId: 'x', file: 'a01.png' });
  });
});
