// Shared types and constants the editor area adds (import from '@toolbar/shared/areas/editor').
// Only the editor area edits this file.
import type { z } from 'zod';
import type { aiDraftSchema } from '../api/captures.ts';

/** Ghost text for a video or replay draft (J-083). Step times are ms from the recording start. */
export type AiDraftText = z.infer<typeof aiDraftSchema>;

/** Why the AI switch is off or empty. */
export type AiUnavailableReason = 'not-video' | 'unavailable' | 'off' | 'not-signed-in' | 'error';

/**
 * Editor choices kept in the extension (chrome.storage.local under EDITOR_PREFS_KEY) and, best
 * effort, in the account's `settings.editor` on the server.
 */
export interface EditorPrefs {
  /** AI switch (J-083): the on or off choice carries over to later drafts */
  ai: boolean;
  /** folder of the last create; fresh drafts preselect it (J-081) */
  lastFolderId: string | null;
  lastWorkspaceId: string | null;
  lastDestination: { integrationId: string; fields: Record<string, unknown> } | null;
}
export const EDITOR_PREFS_KEY = 'nib:editor-prefs';
export const DEFAULT_EDITOR_PREFS: EditorPrefs = { ai: true, lastFolderId: null, lastWorkspaceId: null, lastDestination: null };

/** Destination menu entries (J-079). Paid-account trackers are on the skip list. */
export const DESTINATIONS = [
  { id: 'link', label: 'Share link', integration: null },
  { id: 'github', label: 'GitHub issue', integration: 'github' },
  { id: 'gitlab', label: 'GitLab issue', integration: 'gitlab' },
  { id: 'slack', label: 'Slack message', integration: 'slack' },
  { id: 'webhook', label: 'Webhooks', integration: null },
] as const;
export type DestinationId = (typeof DESTINATIONS)[number]['id'];

/** Most attachments per draft (finalize accepts 20 asset ids). */
export const MAX_ATTACHMENTS = 20;
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Window message types between the editor iframe and the page host beyond EditorFrameMessage. */
export const EDITOR_PAGE = '/editor.html';

/**
 * The description is Markdown: `**bold**`, `*italic*`, `` `code` ``, `- ` bullets and `1. `
 * numbered items, one line per block (render with hard line breaks). The first line of the field
 * is the title and is plain text.
 */
export const DESCRIPTION_FORMAT = 'markdown-breaks' as const;
