// Panels follow playback (J-104): while the video plays, keep the row at the current time in view
// unless the reader scrolled the list themselves; a seek or a pause hands control back.
import { indexAt } from '@toolbar/ui/viewer';
import type { Viewer } from './viewer.svelte.ts';

export function followPlayback(getList: () => HTMLElement | undefined, getRows: () => readonly { at: number }[], v: Viewer) {
  let userScrolledAt = 0;
  const current = $derived(v.hasVideo ? indexAt(getRows(), v.now) : -1);

  $effect(() => {
    const list = getList();
    if (!list) return;
    const mark = () => (userScrolledAt = performance.now());
    list.addEventListener('wheel', mark, { passive: true });
    list.addEventListener('touchmove', mark, { passive: true });
    return () => {
      list.removeEventListener('wheel', mark);
      list.removeEventListener('touchmove', mark);
    };
  });

  $effect(() => {
    const i = current;
    if (!v.playing || i < 0) return;
    if (performance.now() - userScrolledAt < 4000) return;
    const list = getList();
    const row = list?.querySelector<HTMLElement>(`[data-row-index="${i}"]`);
    if (!list || !row) return;
    const lr = list.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    if (rr.top < lr.top + 28 || rr.bottom > lr.bottom) list.scrollTop += rr.top - lr.top - lr.height / 3;
  });

  return {
    get current() {
      return current;
    },
  };
}
