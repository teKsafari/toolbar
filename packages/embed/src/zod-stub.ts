// zod in the embed build (vite.config.ts): the shared contracts define their schemas at the top
// of modules whose constants and helpers the toolbar uses (areas/reviewer.ts, schemas.ts), and the
// page never validates with them. Every property and call of this stand-in returns itself, so the
// definitions run without the 90 KB of zod. A parse through it would be wrong; the embed calls
// none (the schemas validate on the server).
type Chain = ((...args: unknown[]) => Chain) & { [k: string]: Chain };

const chain: Chain = new Proxy(function () {} as unknown as Chain, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => '' : chain),
  apply: () => chain,
});

export const z = chain;
export default chain;
