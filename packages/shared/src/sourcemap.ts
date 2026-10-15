// Map stack frames through the app's own source maps (PLAN "Source location without app
// integration"). The caller supplies fetchText, so the same code runs in the extension's
// service worker (whose fetches never enter a capture, J-248) and in tests. A script is read
// once per URL; its map comes from the SourceMap header or the last sourceMappingURL comment
// (data: URLs included). Nothing is mapped when the app serves no map.
import { TraceMap, originalPositionFor, sourceContentFor } from '@jridgewell/trace-mapping';
import { parseStack, projectPath, type MappedFrame, type StackFrame } from './locator.ts';

export interface FetchedText {
  text: string;
  /** response headers, lower-case names */
  headers?: Record<string, string>;
}

export interface StackMapperOptions {
  fetchText(url: string): Promise<FetchedText | null>;
  /** scripts larger than this are not read (default 8 MB) */
  maxScriptBytes?: number;
  /** maps larger than this are not parsed (default 32 MB) */
  maxMapBytes?: number;
  /** distinct scripts kept in the cache (default 64) */
  cacheSize?: number;
}

type MapEntry = { map: TraceMap | null; reason?: string };

/** The URL of a script's source map, from its headers or its last sourceMappingURL comment. */
export function sourceMapUrlOf(scriptUrl: string, script: FetchedText): string | null {
  const header = script.headers?.['sourcemap'] ?? script.headers?.['x-sourcemap'];
  const tail = script.text.slice(-4096);
  let ref = header ?? null;
  if (!ref) {
    const all = [...tail.matchAll(/[#@]\s*sourceMappingURL=([^\s'"*]+)/g)];
    ref = all.at(-1)?.[1] ?? null;
  }
  if (!ref) {
    // a data: map is often longer than the tail
    const m = /[#@]\s*sourceMappingURL=(data:[^\s'"*]+)\s*$/.exec(script.text.slice(-4 * 1024 * 1024));
    ref = m?.[1] ?? null;
  }
  if (!ref) return null;
  try {
    return new URL(ref, scriptUrl).href;
  } catch {
    return null;
  }
}

function decodeDataUrl(url: string): string | null {
  const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  try {
    if (!m[1]) return decodeURIComponent(m[2]!);
    const bin = atob(m[2]!);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function createStackMapper(opts: StackMapperOptions) {
  const maxScript = opts.maxScriptBytes ?? 8 * 1024 * 1024;
  const maxMap = opts.maxMapBytes ?? 32 * 1024 * 1024;
  const cacheSize = opts.cacheSize ?? 64;
  const cache = new Map<string, Promise<MapEntry>>();

  async function load(scriptUrl: string): Promise<MapEntry> {
    if (!/^https?:\/\//.test(scriptUrl)) return { map: null, reason: 'not_http' };
    const script = await opts.fetchText(scriptUrl).catch(() => null);
    if (!script) return { map: null, reason: 'fetch_failed' };
    if (script.text.length > maxScript) return { map: null, reason: 'too_large' };
    const mapUrl = sourceMapUrlOf(scriptUrl, script);
    if (!mapUrl) return { map: null, reason: 'no_map' };
    let text: string | null;
    if (mapUrl.startsWith('data:')) text = decodeDataUrl(mapUrl);
    else text = (await opts.fetchText(mapUrl).catch(() => null))?.text ?? null;
    if (!text) return { map: null, reason: 'map_fetch_failed' };
    if (text.length > maxMap) return { map: null, reason: 'too_large' };
    try {
      const raw = JSON.parse(text.replace(/^\)\]\}'[^\n]*\n/, '')) as { version: number };
      return { map: new TraceMap(raw as never, mapUrl.startsWith('data:') ? scriptUrl : mapUrl) };
    } catch {
      return { map: null, reason: 'bad_map' };
    }
  }

  function entry(url: string): Promise<MapEntry> {
    // the key keeps the query string: it selects a build (vite's ?t=)
    let p = cache.get(url);
    if (!p) {
      p = load(url);
      cache.set(url, p);
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
    }
    return p;
  }

  async function mapFrame(f: StackFrame): Promise<{ frame: MappedFrame; reason?: string }> {
    const base: MappedFrame = { ...(f.fn ? { fn: f.fn } : {}), url: f.url, line: f.line, col: f.col };
    const e = await entry(f.url);
    if (!e.map) return { frame: base, reason: e.reason };
    const pos = originalPositionFor(e.map, { line: f.line, column: Math.max(0, f.col - 1) });
    if (pos.source == null || pos.line == null) return { frame: base, reason: 'no_mapping' };
    const out: MappedFrame = { ...base, source: pos.source, file: projectPath(pos.source), srcLine: pos.line, srcCol: (pos.column ?? 0) + 1 };
    if (pos.name) out.name = pos.name;
    const content = sourceContentFor(e.map, pos.source);
    if (content) {
      const lineText = content.split('\n')[pos.line - 1];
      if (lineText !== undefined) out.snippet = lineText.trim().slice(0, 200);
    }
    return { frame: out };
  }

  return {
    mapFrame,
    /** Maps every frame of a stack. `mapped` is true when at least one frame has a source. */
    async mapStack(stack: string | undefined, max = 20): Promise<{ frames: MappedFrame[]; mapped: boolean; reason?: string }> {
      const frames = parseStack(stack, max);
      if (!frames.length) return { frames: [], mapped: false, reason: 'no_stack' };
      const results = await Promise.all(frames.map(mapFrame));
      const mapped = results.some((r) => r.frame.source);
      return { frames: results.map((r) => r.frame), mapped, ...(mapped ? {} : { reason: results.find((r) => r.reason)?.reason ?? 'no_map' }) };
    },
    clear() {
      cache.clear();
    },
  };
}

export type StackMapper = ReturnType<typeof createStackMapper>;
