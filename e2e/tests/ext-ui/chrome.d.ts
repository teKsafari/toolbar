// The few extension APIs the ext-ui specs call inside the service worker or an extension page
// (sw.evaluate / page.evaluate). Typed here so the e2e package needs no @types/chrome.
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
      url?: string;
      title?: string;
    }
    function query(q: { url?: string; active?: boolean; lastFocusedWindow?: boolean }): Promise<Tab[]>;
  }
  namespace commands {
    function getAll(): Promise<{ name?: string; shortcut?: string; description?: string }[]>;
  }
  namespace runtime {
    function reload(): void;
    function sendMessage(msg: unknown): Promise<unknown>;
  }
}
