// Uncaught errors, unhandled rejections, failed resource loads and CSP violations (J-057).
// Better than the reference: unhandled rejections are kept as error rows.
import type { PageError } from '@toolbar/shared';
import type { HookInstaller } from '../transport.ts';
import { quiet } from './util.ts';

function fromReason(reason: unknown): Omit<PageError, 'type'> {
  if (reason instanceof Error || (reason && typeof reason === 'object' && 'message' in reason)) {
    const e = reason as Error;
    return { name: String(e.name ?? 'Error'), message: String(e.message ?? ''), stack: typeof e.stack === 'string' ? e.stack : undefined };
  }
  let message: string;
  try {
    message = typeof reason === 'string' ? reason : JSON.stringify(reason) ?? String(reason);
  } catch {
    message = String(reason);
  }
  return { message };
}

export const installErrorsHook: HookInstaller = (emit, win) => {
  if (typeof win.addEventListener !== 'function') return () => {};
  const onError = (ev: Event) =>
    quiet(() => {
      if ((typeof ErrorEvent !== 'undefined' && ev instanceof ErrorEvent) || (ev as ErrorEvent).message !== undefined) {
        const e = ev as ErrorEvent;
        const base = e.error !== undefined && e.error !== null ? fromReason(e.error) : { message: e.message };
        emit('error', {
          type: 'error',
          ...base,
          message: base.message || e.message || 'Script error.',
          src: e.filename || undefined,
          line: e.lineno || undefined,
          col: e.colno || undefined,
        });
        return;
      }
      // Resource errors do not bubble; the capture-phase listener sees them with the element as target.
      const t = ev.target as (Element & { src?: string; href?: string; currentSrc?: string }) | null;
      if (t && t !== (win as unknown) && typeof t.tagName === 'string') {
        const src = t.currentSrc || t.src || t.href || undefined;
        emit('error', { type: 'resource', message: `Failed to load ${t.tagName.toLowerCase()}${src ? ` ${src}` : ''}`, src });
      }
    });
  const onRejection = (ev: PromiseRejectionEvent) =>
    quiet(() => {
      const base = fromReason(ev.reason);
      emit('error', { type: 'unhandledrejection', ...base, message: base.message || 'Unhandled promise rejection' });
    });
  const onCsp = (ev: SecurityPolicyViolationEvent) =>
    quiet(() =>
      emit('error', {
        type: 'csp',
        message: `Refused by Content-Security-Policy ${ev.effectiveDirective}: ${ev.blockedURI || 'inline'}`,
        src: ev.sourceFile || undefined,
        line: ev.lineNumber || undefined,
        col: ev.columnNumber || undefined,
      }),
    );
  win.addEventListener('error', onError, true);
  win.addEventListener('unhandledrejection', onRejection as EventListener);
  win.addEventListener('securitypolicyviolation', onCsp as EventListener);
  return () => {
    win.removeEventListener('error', onError, true);
    win.removeEventListener('unhandledrejection', onRejection as EventListener);
    win.removeEventListener('securitypolicyviolation', onCsp as EventListener);
  };
};
