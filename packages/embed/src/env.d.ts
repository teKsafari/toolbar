// Types for the source only. React is an optional peer the package never bundles; the two hooks
// the wrapper uses are declared here so the workspace needs no React install.
declare module 'react' {
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T>(initial: T): { current: T };
}

// the Svelte runtime ships no types for its internal entry (svelte-client.ts re-exports it)
declare module 'svelte/internal/client';
