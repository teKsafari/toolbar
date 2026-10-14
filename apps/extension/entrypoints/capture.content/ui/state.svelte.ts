// The in-page UI state: a view of the service worker's capture session for this tab.
// Filled from session.get on mount and from every ui.session command after that.
import { IDLE, type CaptureSession, type UiSessionCommand } from '@toolbar/shared/ext';
import { COUNTDOWN_FROM } from '@toolbar/shared/areas/ext-ui';

class UiState {
  session: CaptureSession = $state(IDLE);
  tabId: number | null = $state(null);
  /** countdown time left at countdownAt (page clock) */
  countdownLeftMs = $state(COUNTDOWN_FROM * 1000);
  countdownAt = $state(0);
  capMs: number | null = $state(null);
  tool: 'pen' | 'blur' | null = $state(null);
  /** settings the bar shows before media starts */
  micSetting = $state(false);

  apply(cmd: Pick<UiSessionCommand, 'session' | 'countdownLeftMs' | 'capMs' | 'tool'>) {
    const s = cmd.session;
    // a command for another tab (desktop mode moved on) clears this one
    this.session = this.tabId !== null && 'tabId' in s && s.tabId !== this.tabId ? IDLE : s;
    this.countdownLeftMs = cmd.countdownLeftMs;
    this.countdownAt = Date.now();
    this.capMs = cmd.capMs;
    this.tool = cmd.tool;
  }
}

export const ui = new UiState();
