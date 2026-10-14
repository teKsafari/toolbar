// Data the capture page gets from its load function (/c/[id] and /s/[token]).
import type { CaptureDetail, CommentThread, SeatRole } from '@toolbar/shared/api';

export interface ViewerData {
  /** member: /c/[id] for workspace members; share: /s/[token] (logged-out or outside viewer) */
  mode: 'member' | 'share';
  detail: CaptureDetail;
  threads: CommentThread[];
  me: { id: string; name: string; email: string; image: string | null } | null;
  role: SeatRole | null;
  shareToken: string | null;
  /** false on a content-only link (J-118): no dev tools panel */
  devtools: boolean;
  folders: { id: string; name: string }[];
  members: { id: string; name: string; email: string }[];
  integrations: { id: string; type: string; name: string }[];
  cues: { startMs: number; endMs: number; text: string }[];
  /** ?t= in seconds (J-097) */
  startAt: number | null;
  /** ?comment= (J-129) */
  highlight: string | null;
}
