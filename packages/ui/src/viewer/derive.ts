// Panel models derived from the merged event list (events.json.gz): the shared ones, so the
// viewer, the REST API, MCP and the markdown summary show the same rows. The viewer kept its own
// copy after the merge, and the two drifted (the webRequest merge window and the desktop tab id
// were fixed in one and not the other).
export {
  CONSOLE_KIND_CHIPS,
  NETWORK_CHIPS,
  computeEventIndex,
  deriveActions,
  deriveConsole,
  deriveMarkers,
  deriveNetwork,
  describeTarget,
  errorMessageOf,
  filterConsole,
  filterNetwork,
  isFailed,
  presentConsoleChips,
  sortNetwork,
  targetAttributes,
  stackFrames,
  topFrame,
} from '@toolbar/shared/derive';
export type { ActionRow, ActionViewRow, At, ConsoleKindChip, ConsoleViewRow, NetworkChip, NetworkSortKey, NetworkViewRow, WsFrameRow } from '@toolbar/shared/derive';
