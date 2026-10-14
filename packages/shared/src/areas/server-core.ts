// Shared types and constants the server-core area adds (import from '@toolbar/shared/areas/server-core').
// Only the server-core area edits this file.

/** Rendition heights the renditions job produces below the original (J-054). */
export const RENDITION_HEIGHTS = [720, 480, 360, 240] as const;

/** Media names served by /api/v1/recordings/:id/media/:name and /s/:token/media/:name. */
export const MEDIA_NAMES = ['video', 'video-720', 'video-480', 'video-360', 'video-240', 'screenshot', 'full', 'thumb', 'voice', 'events', 'transcript'] as const;
/** rrweb chunks are `rrweb-000`, `rrweb-001`, ...; assets of the capture are served by asset id. */
export const rrwebMediaName = (seq: number) => `rrweb-${String(seq).padStart(3, '0')}`;
