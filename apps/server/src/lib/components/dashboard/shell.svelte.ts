// Client state shared by the dashboard shell: a card being dragged (J-166), the palette (J-161),
// the mobile sidebar drawer, and a counter pages watch to reload their lists.
class Shell {
  /** capture ids being dragged onto a folder */
  dragging: string[] = $state([]);
  paletteOpen = $state(false);
  drawerOpen = $state(false);
  /** bump to make the visible grid reload (after a move, delete or upload) */
  reloadTick = $state(0);
  reload() {
    this.reloadTick++;
  }
}

export const shell = new Shell();

export const DRAG_MIME = 'application/x-nib-captures';
