// MCP tools of the agent hand-off (PLAN "Hand-off to the agent"): the same feedback folder the
// HTTP API serves as a tar.gz, as a listing with the README, one file at a time, and resolving.
import { z } from 'zod';
import { roleAtLeast } from '@toolbar/shared/api';
import { MAX_KEYFRAMES } from '@toolbar/shared/areas/handoff';
import { fail } from '../share/http.ts';
import { folderOf, fileBytes } from '../handoff/folder.ts';
import { folderIndex } from '../handoff/http.ts';
import { resolveFeedback } from '../handoff/resolve.ts';
import { resolveCapture } from './access.ts';
import type { ToolDef, ToolResult } from './tools.ts';

const intent = z.string().max(500).optional().describe('One sentence on why you are calling this tool, for the audit trail.');
const capture = z.string().min(1).describe('Capture id, member URL (<server>/c/<id>) or share link (<server>/s/<token>).');
const define = <S extends z.ZodObject>(t: ToolDef<S>) => t as unknown as ToolDef;
const text = (s: string) => ({ type: 'text' as const, text: s });

/** Text files up to this size come back whole; larger ones in pages of this many characters. */
const PAGE_CHARS = 60_000;

async function memberFolder(ctx: Parameters<ToolDef['run']>[0], ref: string) {
  const c = await resolveCapture(ctx.db, ctx.principal, ref);
  if (c.via !== 'member') fail('forbidden', 'The feedback folder needs a seat in the capture\'s workspace; a share link gives the summary only (fetch it with Accept: text/markdown).');
  if (c.rec.status === 'uploading') fail('conflict', 'The capture is still uploading. Try again when it is ready.');
  return { c, built: (await folderOf(ctx.db, c.rec)).folder };
}

export const getFeedbackFolder = define({
  name: 'get_feedback_folder',
  title: 'Get the feedback folder',
  description: `The feedback folder of a capture, as an agent would pull it with curl: README.md (read it first: who, app, the reviewer's words, what did not happen, the timeline), then the list of files (feedback.json, spans.jsonl, annotations/aNN.png and .locator.json, keyframes/ (about ${MAX_KEYFRAMES} images), outline/, text/ (OCR), voice/, console.jsonl, network.jsonl, raw/) with sizes, and the shell command that downloads the whole folder. Read single files with get_feedback_file; open images only when the timeline points at them.`,
  input: z.object({ capture, intent }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async run(ctx, a): Promise<ToolResult> {
    const { built } = await memberFolder(ctx, a.capture);
    const idx = folderIndex(built);
    return {
      content: [
        text(built.readme),
        text(JSON.stringify({ id: idx.id, dir: idx.dir, pullCommand: idx.pullCommand, readmeTokens: idx.readmeTokens, files: idx.files.map(({ path, bytes, about }) => ({ path, bytes, about })) })),
      ],
    };
  },
});

export const getFeedbackFile = define({
  name: 'get_feedback_file',
  title: 'Read a file of the feedback folder',
  description:
    'One file of the feedback folder by its path inside the folder (README.md, spans.jsonl, network.jsonl, annotations/a01.png, keyframes/k03.png, voice/transcript.vtt ...). Images come back as images; text in pages of 60,000 characters (pass offset for the next page). Audio and raw/ archives are not returned here: pull the folder with the command from get_feedback_folder.',
  input: z.object({
    capture,
    path: z.string().min(1).max(300).describe('Path inside the folder, as get_feedback_folder lists it.'),
    offset: z.number().int().min(0).default(0).describe('Character offset for text files.'),
    intent,
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async run(ctx, a): Promise<ToolResult> {
    const { built } = await memberFolder(ctx, a.capture);
    const want = a.path.replace(/^\.\//, '').replace(`${built.dir}/`, '');
    const f = built.files.find((x) => x.path === want);
    if (!f) fail('not_found', `No file ${want} in the folder. get_feedback_folder lists the files.`);
    if (f!.contentType.startsWith('image/')) {
      const data = Buffer.from(f!.data as Uint8Array).toString('base64');
      return { content: [text(`${f!.path}: ${f!.about}`), { type: 'image', data, mimeType: f!.contentType }] };
    }
    if (typeof f!.data !== 'string') fail('unavailable', `${f!.path} is binary (${f!.contentType}, ${fileBytes(f!.data)} bytes). Pull the folder with the command from get_feedback_folder to get it.`);
    const s = f!.data as string;
    const page = s.slice(a.offset, a.offset + PAGE_CHARS);
    const more = a.offset + PAGE_CHARS < s.length;
    return { content: [text(page), ...(more ? [text(`[${s.length - a.offset - PAGE_CHARS} more characters: call again with offset ${a.offset + PAGE_CHARS}]`)] : [])] };
  },
});

export const resolveFeedbackTool = define({
  name: 'resolve_feedback',
  title: 'Mark feedback resolved',
  description: 'Mark a capture\'s feedback resolved once the fix is in: a short note on the cause and the fix, and the commit or PR. Pass items to close only some of the reviewer\'s pins; the capture counts as resolved when none is left open. Fires the feedback.resolved webhook. Needs the creator seat or higher.',
  input: z.object({
    capture,
    note: z.string().trim().min(1).max(4000).describe('The cause and the fix, in one or two sentences.'),
    commit: z.string().trim().max(200).optional().describe('Commit SHA or PR link of the fix.'),
    items: z.array(z.number().int().positive()).max(500).optional().describe('Pin numbers of the reviewer\'s toolbar items this fix closes (feedback.json annotations[].pin). Leave out to resolve the whole capture and every open pin.'),
    intent,
  }),
  write: true,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, a): Promise<ToolResult> {
    const c = await resolveCapture(ctx.db, ctx.principal, a.capture, 'comment');
    if (!c.seat || !roleAtLeast(c.seat, 'creator')) fail('forbidden', 'Resolving feedback needs the creator seat or higher.');
    const r = await resolveFeedback(ctx.db, c.rec, ctx.principal.userId, { note: a.note, commit: a.commit, items: a.items }, ctx.principal.clientName ?? 'MCP');
    return { content: [text(JSON.stringify(r))] };
  },
});

export const HANDOFF_TOOLS = [getFeedbackFolder, getFeedbackFile, resolveFeedbackTool];
