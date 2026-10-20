// Types for the source only. React is an optional peer the package never bundles; the one hook
// the wrapper uses is declared here so the workspace needs no React install.
declare module 'react' {
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
}

// the Svelte runtime ships no types for its internal entry (svelte-client.ts re-exports it)
declare module 'svelte/internal/client';
