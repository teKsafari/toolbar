// The few chrome.* APIs the editor e2e calls inside the service worker (sw.evaluate).
declare namespace chrome {
  namespace tabs {
    interface Tab {
      id?: number;
      index: number;
      url?: string;
      pendingUrl?: string;
      active: boolean;
    }
    function query(q: { currentWindow?: boolean; active?: boolean }): Promise<Tab[]>;
    function remove(id: number): Promise<void>;
  }
  namespace storage {
    namespace local {
      function set(items: Record<string, unknown>): Promise<void>;
      function get(keys: string | string[]): Promise<Record<string, unknown>>;
    }
  }
}
