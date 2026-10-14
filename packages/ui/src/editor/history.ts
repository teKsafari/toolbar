// Snapshot undo/redo. Each create, move, resize, recolour, delete, paste or trim drag is one step.

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private limit = 200) {}

  /** Record the state before a change. */
  push(before: T) {
    this.past.push(structuredClone(before));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(structuredClone(current));
    return prev;
  }
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(structuredClone(current));
    return next;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
