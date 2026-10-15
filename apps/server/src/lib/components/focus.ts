// Focus an element as soon as it is in the page. The `autofocus` attribute is not enough for
// fields that appear after a button click: Svelte applies it only while nothing else has the
// focus, and the button that opened the field still has it, so typed text went nowhere (J-163).
export function focusNow(node: HTMLElement, opts: { select?: boolean } = {}) {
  const run = () => {
    if (!node.isConnected) return;
    node.focus({ preventScroll: true });
    if (opts.select && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) node.select();
  };
  queueMicrotask(run);
  const raf = requestAnimationFrame(run);
  return { destroy: () => cancelAnimationFrame(raf) };
}
