// The few extension APIs the ext-ui and editor specs call inside the service worker or an
// extension page (sw.evaluate / page.evaluate). Typed here so the e2e package needs no
// @types/chrome. One declaration for every spec: two ambient copies do not merge.
declare namespace chrome {
  interface StorageArea {
    get(keys?: string | string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
  }
  const storage: { local: StorageArea; session: StorageArea };
  namespace tabs {
    interface Tab {
      id?: number;
      index: number;
      url?: string;
      pendingUrl?: string;
      title?: string;
      active: boolean;
    }
    function query(q: { url?: string; active?: boolean; currentWindow?: boolean; lastFocusedWindow?: boolean }): Promise<Tab[]>;
    function remove(id: number): Promise<void>;
  }
  namespace commands {
    function getAll(): Promise<{ name?: string; shortcut?: string; description?: string }[]>;
  }
  namespace action {
    function getTitle(details: { tabId?: number }): Promise<string>;
  }
  namespace runtime {
    function reload(): void;
    function sendMessage(msg: unknown): Promise<unknown>;
  }
}
