// The messaging contract lives in @toolbar/shared/ext (packages/shared/src/ext/messages.ts) so
// the server-side tests and every area agent read one definition. Re-exported here for the
// existing imports.
export {
  CAPTURE_PORT,
  type PortMessage,
  type PortCommand,
  type BgRequest,
  type BgRequestMap,
  type BgResult,
  type ContentCommand,
  type Broadcast,
  type OffscreenRequest,
  type OffscreenEvent,
} from '@toolbar/shared/ext';
