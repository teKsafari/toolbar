// Shared bits of the folder routes and MCP tools: member-only access to a capture's folder.
import type { RequestEvent } from '@sveltejs/kit';
import type { FolderIndex } from '@toolbar/shared/api';
import { db } from '../db/index.ts';
import { fail } from '../share/http.ts';
import { captureAccess, type RecordingRow } from '../share/access.ts';
import type { BuiltFolder } from './assemble.ts';
import { fileBytes } from './folder.ts';

/** The capture, for a member of its workspace; share links, upload tokens and anonymous callers are refused. */
export async function folderCapture(event: RequestEvent, id: string): Promise<RecordingRow> {
  const a = await captureAccess(db, event, id, { mode: 'member' });
  if (a.via !== 'member') fail('forbidden', 'The feedback folder needs a personal token of a workspace member.');
  if (a.rec.status === 'uploading') fail('conflict', 'The capture is still uploading. Try again when it is ready.');
  return a.rec;
}

export function folderIndex(f: BuiltFolder): FolderIndex {
  return {
    id: f.id,
    dir: f.dir,
    pullCommand: f.pullCommand,
    files: f.files.map((x) => ({ path: x.path, bytes: fileBytes(x.data), about: x.about, contentType: x.contentType })),
    readme: f.readme,
    readmeTokens: f.readmeTokens,
  };
}
