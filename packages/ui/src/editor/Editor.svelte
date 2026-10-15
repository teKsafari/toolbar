<script lang="ts">
  // The draft editor (J-037): a large modal over the dimmed page. Left about 70%: close button,
  // preview, floating tool pill (screenshots) or play and trim (videos). Right about 30%: the
  // submit form. Everything outside talks through `host`.
  import { onMount, tick, untrack } from 'svelte';
  import type { ExtBootstrap, Integration } from '@toolbar/shared/api';
  import { DEFAULT_EDITOR_PREFS, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '@toolbar/shared/areas/editor';
  import Toaster from '../lib/Toaster.svelte';
  import { toasts } from '../lib/toast.svelte.ts';
  import Annotator from './Annotator.svelte';
  import ToolPill from './ToolPill.svelte';
  import VideoDraft from './VideoDraft.svelte';
  import RichField from './RichField.svelte';
  import Menu, { type MenuItem } from './Menu.svelte';
  import EdIcon from './EdIcon.svelte';
  import Tip from './Tip.svelte';
  import { AnnotatorState } from './annotator.svelte.ts';
  import { TrimState } from './trim.svelte.ts';
  import { canvasMeasure } from './render.ts';
  import { flattenPng, loadImage } from './flatten.ts';
  import type { Shape } from './shapes.ts';
  import type { TitleAndBody } from './richtext.ts';
  import type { AiDraftText, AiUnavailableReason, AttachmentInfo, EditorData, EditorHost, EditorPrefs, TrackerOptions } from './types.ts';

  interface Props {
    host: EditorHost;
    /** ms between the two Escape presses that discard (J-088) */
    escapeWindowMs?: number;
  }
  let { host, escapeWindowMs = 1000 }: Props = $props();

  type Dest = { type: 'link' } | { type: 'integration'; integrationId: string; fields: Record<string, unknown> };

  let data = $state<EditorData | null>(null);
  let loadError = $state<string | null>(null);
  let ann = $state<AnnotatorState | null>(null);
  let trim = $state<TrimState | null>(null);
  let text = $state<TitleAndBody>({ title: '', description: '' });
  let boot = $state<ExtBootstrap | null>(null);
  let prefs = $state<EditorPrefs>({ ...DEFAULT_EDITOR_PREFS });
  let workspaceId = $state<string | null>(null);
  let folderId = $state<string | null>(null);
  let destination = $state<Dest>({ type: 'link' });
  let attachments = $state<AttachmentInfo[]>([]);
  let keepFull = $state(true);
  let ai = $state<AiDraftText | null>(null);
  let aiLoading = $state(false);
  let aiReason = $state<AiUnavailableReason | null>(null);
  let aiAccepted = $state(false);
  let creating = $state(false);
  let escAt = 0;
  let escToast = 0;
  let field = $state<ReturnType<typeof RichField> | undefined>();
  let player = $state<ReturnType<typeof VideoDraft> | undefined>();
  let fileInput = $state<HTMLInputElement | undefined>();
  let shown = $state(false);

  const kind = $derived(data?.draft.kind ?? 'screenshot');
  const isImage = $derived(kind === 'screenshot');
  const reopened = $derived(!!data?.draft.reopenedAt && !isImage);
  const isArea = $derived(isImage && !!data?.draft.crop && !!data?.fullUrl);
  const workspaces = $derived(boot?.workspaces ?? []);
  const workspace = $derived(workspaces.find((w) => w.id === workspaceId) ?? null);
  const folders = $derived((boot?.folders ?? []).filter((f) => !workspaceId || f.workspaceId === workspaceId));
  const folder = $derived(folders.find((f) => f.id === folderId) ?? null);
  const integrations = $derived((boot?.integrations ?? []).filter((i) => !workspaceId || i.workspaceId === workspaceId));
  const destIntegration = $derived(destination.type === 'integration' ? (integrations.find((i) => i.id === (destination as { integrationId: string }).integrationId) ?? null) : null);
  // AI is a paused feature (docs/scope.md, D-084): the switch shows only when the server turned
  // FEATURE_AI on; until the bootstrap answers it stays hidden, so it never flashes
  const aiFeature = $derived(!!boot?.features?.ai);
  const aiAvailable = $derived(boot ? boot.limits.aiAvailable : true);
  const aiDisabledReason = $derived(
    isImage ? 'AI drafts are for videos and replays' : !aiAvailable || aiReason === 'unavailable' ? 'AI is not set up on this server' : aiReason === 'not-signed-in' ? 'Sign in to use AI drafts' : null,
  );
  const aiOn = $derived(aiFeature && prefs.ai && !aiDisabledReason);

  onMount(() => {
    void init();
    requestAnimationFrame(() => (shown = true));
  });

  async function init() {
    try {
      const d = await host.load();
      const p = await host.prefs().catch(() => ({ ...DEFAULT_EDITOR_PREFS }));
      prefs = p;
      text = { title: d.draft.title ?? '', description: d.draft.description ?? '' };
      keepFull = d.draft.keepFull ?? true;
      attachments = d.attachments;
      aiAccepted = d.draft.aiAccepted ?? false;
      ai = d.draft.ai ?? null;
      destination = d.draft.destination ?? { type: 'link' };
      if (d.draft.kind === 'screenshot' && d.screenshotUrl) {
        const img = await loadImage(d.screenshotUrl);
        const shapes = (d.draft.annotations?.[0]?.shapes ?? []) as unknown as Shape[];
        ann = new AnnotatorState({ width: img.naturalWidth, height: img.naturalHeight, shapes, measure: canvasMeasure() });
      } else if (d.draft.kind !== 'screenshot') {
        trim = new TrimState(d.draft.durationMs ?? 0, d.draft.trim);
      }
      data = d;
      // A fresh draft carries the browser's active workspace; the workspace and folder picked for
      // the last capture win over it, so the remembered folder applies (J-081).
      const freshDraft = !d.draft.reopenedAt && !d.draft.title;
      void loadBootstrap(freshDraft && p.lastWorkspaceId ? p.lastWorkspaceId : (d.draft.workspaceId ?? p.lastWorkspaceId), d);
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadBootstrap(wanted: string | null, d: EditorData) {
    const b = await host.bootstrap(wanted).catch(() => null);
    boot = b;
    const fresh = !d.draft.reopenedAt && !d.draft.title;
    if (b) {
      workspaceId = b.workspaces.some((w) => w.id === wanted) ? wanted : (b.activeWorkspaceId ?? b.workspaces[0]?.id ?? null);
      const wantFolder = d.draft.folderId ?? (fresh ? prefs.lastFolderId : null);
      folderId = b.folders.some((f) => f.id === wantFolder && (!workspaceId || f.workspaceId === workspaceId)) ? wantFolder : null;
      if (destination.type === 'integration' && !b.integrations.some((i) => i.id === (destination as { integrationId: string }).integrationId)) destination = { type: 'link' };
    } else {
      workspaceId = d.draft.workspaceId;
      folderId = d.draft.folderId;
    }
    if (!isImage && prefs.ai) void fetchAi();
  }

  async function fetchAi() {
    if (ai || aiLoading || isImage || !aiFeature || !boot?.limits.aiAvailable) return;
    aiLoading = true;
    try {
      const r = await host.ai();
      ai = r.ai;
      aiReason = r.reason;
      if (r.ai) void host.update({ ai: r.ai });
    } catch {
      aiReason = 'error';
    } finally {
      aiLoading = false;
    }
  }

  async function switchWorkspace(id: string) {
    if (id === workspaceId) return;
    workspaceId = id;
    const b = await host.bootstrap(id).catch(() => null);
    if (b) boot = b;
    if (!folders.some((f) => f.id === folderId)) folderId = null;
    if (destination.type === 'integration' && !integrations.some((i) => i.id === (destination as { integrationId: string }).integrationId)) destination = { type: 'link' };
  }

  function toggleAi() {
    if (aiDisabledReason) return;
    prefs.ai = !prefs.ai;
    void host.savePrefs({ ai: prefs.ai });
    if (prefs.ai) void fetchAi();
  }

  // ---------- autosave ----------
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function snapshotPatch() {
    return {
      title: text.title,
      description: text.description,
      annotations: ann ? [{ shapes: $state.snapshot(ann.shapes) as unknown as Record<string, unknown>[] }] : (data?.draft.annotations ?? []),
      trim: trim ? trim.range : (data?.draft.trim ?? null),
      folderId,
      workspaceId,
      keepFull,
      aiAccepted,
      destination: $state.snapshot(destination) as Dest,
      attachmentBlobIds: attachments.map((a) => a.id),
      durationMs: trim ? trim.durationMs || (data?.draft.durationMs ?? null) : (data?.draft.durationMs ?? null),
    };
  }
  $effect(() => {
    if (!data) return;
    // track every field the draft keeps
    void [text.title, text.description, ann?.version, trim?.version, folderId, workspaceId, keepFull, aiAccepted, destination, attachments.length];
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!creating) void host.update(snapshotPatch()).catch(() => {});
    }, 400);
  });

  // ---------- create, discard, save ----------

  async function flatten(): Promise<{ flat: string | null; full: string | null }> {
    if (!isImage || !data?.screenshotUrl || !ann) return { flat: null, full: null };
    const shapes = $state.snapshot(ann.shapes) as Shape[];
    const size = { w: ann.width, h: ann.height };
    const out = await flattenPng(data.screenshotUrl, shapes, size, { measure: ann.measure });
    const flat = await host.putBlob(out.blob);
    let full: string | null = null;
    const crop = data.draft.crop;
    if (isArea && keepFull && crop && data.fullUrl) {
      const dpr = ann.width / Math.max(1, crop.w);
      const place = { x: crop.x * dpr, y: crop.y * dpr, w: ann.width, h: ann.height };
      const f = await flattenPng(data.fullUrl, shapes, size, { measure: ann.measure, place });
      full = await host.putBlob(f.blob);
    }
    return { flat, full };
  }

  async function create() {
    if (creating || !data) return;
    ann?.commitText();
    creating = true;
    clearTimeout(saveTimer);
    // one progress toast (J-086): the page's when the host shows it, else the editor's own
    const outside = host.progress;
    outside?.start();
    const tid = outside ? null : toasts.loading('Creating your link');
    try {
      await host.update(snapshotPatch()).catch(() => {});
      const { flat, full } = await flatten();
      const res = await host.create({
        finalize: {
          title: text.title,
          description: text.description,
          folderId,
          workspaceId: workspaceId ?? undefined,
          annotations: ann && ann.shapes.length ? [{ shapes: $state.snapshot(ann.shapes) as unknown as Record<string, unknown>[] }] : [],
          trim: trim ? trim.range : null,
          destination: $state.snapshot(destination) as Dest,
          attachmentAssetIds: [],
          aiAccepted,
          durationMs: trim ? Math.round(trim.lengthMs) : undefined,
        },
        flatBlobId: flat,
        flatFullBlobId: full,
      });
      const copied = await host.copy(res.shareUrl);
      const o = await host.openCapture?.(res, data.draft.tabId).catch(() => undefined);
      // J-089: the extension setting may keep the capture page closed
      const opened = !o || o.opened;
      if (tid !== null) toasts.update(tid, { kind: 'success', message: `${copied ? 'Link copied.' : 'Capture created.'}${opened ? ' The capture opened in a new tab.' : ''}` });
      if (res.issueError) toasts.error(`The capture is saved, but filing the issue failed: ${res.issueError}`);
      void host.savePrefs({
        lastFolderId: folderId,
        lastWorkspaceId: workspaceId,
        lastDestination: destination.type === 'integration' ? { integrationId: destination.integrationId, fields: $state.snapshot(destination.fields) as Record<string, unknown> } : null,
      });
      host.close('created', { copied, opened, issueError: res.issueError });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not create the capture';
      outside?.fail();
      if (tid !== null) toasts.update(tid, { kind: 'error', message, duration: 6000 });
      else toasts.error(message, { duration: 6000 });
      creating = false;
    }
  }

  async function discard() {
    clearTimeout(saveTimer);
    await host.discard().catch(() => {});
    host.close('discarded');
  }

  async function saveForLater() {
    clearTimeout(saveTimer);
    await host.update(snapshotPatch()).catch(() => {});
    await host.saveForLater().catch(() => {});
    host.close('saved');
  }

  function closeClick() {
    if (reopened) void saveForLater();
    else void discard();
  }

  function escape() {
    const now = Date.now();
    if (now - escAt <= escapeWindowMs) {
      toasts.dismiss(escToast);
      void discard();
      return;
    }
    escAt = now;
    toasts.dismiss(escToast);
    escToast = toasts.show('Press Escape again to discard this draft', { duration: escapeWindowMs + 200 });
  }

  // ---------- attachments ----------

  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (attachments.length >= MAX_ATTACHMENTS) {
        toasts.error(`Up to ${MAX_ATTACHMENTS} attachments`);
        break;
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toasts.error(`${f.name} is larger than ${Math.round(MAX_ATTACHMENT_BYTES / 1048576)} MB`);
        continue;
      }
      const id = await host.putBlob(f);
      attachments.push({ id, name: f.name, type: f.type, size: f.size });
    }
    if (fileInput) fileInput.value = '';
  }
  function removeAttachment(id: string) {
    attachments = attachments.filter((a) => a.id !== id);
    void host.deleteBlob(id).catch(() => {});
  }

  async function thumb(blob: Blob) {
    if (data?.draft.thumbBlobId) return;
    const id = await host.putBlob(blob);
    void host.update({ thumbBlobId: id });
  }

  // ---------- keyboard ----------

  function editable(t: EventTarget | null) {
    const el = t as HTMLElement | null;
    return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
  }

  function onKey(e: KeyboardEvent) {
    if (creating) return;
    // Escape works from the first frame, even while the draft is still loading (J-088)
    if (e.key === 'Escape' && !data) {
      e.preventDefault();
      escape();
      return;
    }
    if (!data) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && mod) {
      e.preventDefault();
      void create();
      return;
    }
    if (e.key === 'Escape') {
      if (ann?.editing) return;
      e.preventDefault();
      escape();
      return;
    }
    if (editable(e.target)) return;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) (ann ?? trim)?.redo();
      else (ann ?? trim)?.undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      (ann ?? trim)?.redo();
      return;
    }
    if (ann) {
      if (mod && k === 'c') {
        if (ann.copy()) e.preventDefault();
        return;
      }
      if (mod && k === 'v') {
        if (ann.paste()) e.preventDefault();
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        ann.selectAll();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        ann.deleteSelected();
      } else if (k === 'v') ann.setTool('select');
      else if (k === 'd') ann.setTool('pen');
      else if (k === 't') ann.setTool('text');
    } else if (trim && e.key === ' ' && !mod) {
      e.preventDefault();
      void player?.toggle();
    }
  }

  // ---------- menus ----------

  const destLabel = $derived(
    destination.type === 'link' ? 'Share link' : destIntegration ? `${destIntegration.type === 'slack' ? 'Slack' : destIntegration.type === 'gitlab' ? 'GitLab' : 'GitHub'}: ${destIntegration.name}` : 'Share link',
  );
  const destIcon = (t: Integration['type']) => (t === 'slack' ? 'hash' : t === 'gitlab' ? 'merge' : 'issue');
  type DestPick = { kind: 'link' } | { kind: 'integration'; id: string } | { kind: 'connect'; type: string };
  const destItems = $derived.by((): MenuItem<DestPick>[] => {
    const out: MenuItem<DestPick>[] = [{ value: { kind: 'link' }, label: 'Share link', icon: 'link', checked: destination.type === 'link', testid: 'dest-link' }];
    for (const [type, name] of [
      ['github', 'GitHub'],
      ['gitlab', 'GitLab'],
      ['slack', 'Slack'],
    ] as const) {
      const conns = integrations.filter((i) => i.type === type);
      if (conns.length)
        for (const c of conns)
          out.push({
            value: { kind: 'integration', id: c.id },
            label: `${name}: ${c.name}`,
            icon: destIcon(type),
            checked: destination.type === 'integration' && destination.integrationId === c.id,
            testid: `dest-${type}`,
          });
      else out.push({ value: { kind: 'connect', type }, label: name, hint: 'Connect', icon: destIcon(type), testid: `dest-${type}` });
    }
    out.push({ value: { kind: 'connect', type: 'webhooks' }, label: 'Webhook', hint: 'Settings', icon: 'plug', testid: 'dest-webhook' });
    return out;
  });
  function pickDest(v: DestPick) {
    if (v.kind === 'link') destination = { type: 'link' };
    else if (v.kind === 'integration') {
      const c = integrations.find((i) => i.id === v.id);
      const remembered = prefs.lastDestination?.integrationId === v.id ? prefs.lastDestination.fields : {};
      destination = { type: 'integration', integrationId: v.id, fields: { repo: c?.defaultTarget ?? undefined, ...remembered } };
    } else host.openUrl(`${host.serverUrl()}/settings/integrations${v.type === 'webhooks' ? '#webhooks' : `#${v.type}`}`);
  }
  function setField(key: string, value: unknown) {
    if (destination.type !== 'integration') return;
    destination = { ...destination, fields: { ...destination.fields, [key]: value } };
  }

  // ---------- tracker field form (J-140) ----------

  let trackerOpts = $state<TrackerOptions | null>(null);
  let trackerErr = $state<string | null>(null);
  let trackerLoading = $state(false);
  let trackerKey = '';
  /** the repo the options were loaded for */
  let trackerRepo: string | undefined;
  const trackerName = $derived(destIntegration?.type === 'gitlab' ? 'GitLab' : 'GitHub');

  async function loadTracker(integrationId: string, repo: string | undefined, fillRecent: boolean) {
    if (!host.trackerOptions) return;
    trackerLoading = true;
    trackerRepo = repo;
    try {
      const r = await host.trackerOptions(integrationId, repo);
      if (destination.type !== 'integration' || destination.integrationId !== integrationId) return;
      trackerOpts = r.options;
      trackerErr = r.error;
      // remembered values fill what the person has not set (J-140 recents)
      if (fillRecent && r.recent) {
        const f = destination.fields;
        const rec = r.recent;
        const next: Record<string, unknown> = { ...f };
        if (!f.repo && rec.repo) next.repo = rec.repo;
        if (!(f.labels as string[] | undefined)?.length && rec.labels?.length) next.labels = rec.labels;
        if (!(f.assignees as string[] | undefined)?.length && rec.assignees?.length) next.assignees = rec.assignees;
        if (!f.milestone && rec.milestone) next.milestone = rec.milestone;
        destination = { ...destination, fields: next };
        if (next.repo && next.repo !== repo) return loadTracker(integrationId, next.repo as string, false);
      }
    } finally {
      trackerLoading = false;
    }
  }
  $effect(() => {
    const d = destIntegration;
    if (!d || d.type === 'slack') {
      trackerKey = '';
      trackerOpts = null;
      trackerErr = null;
      return;
    }
    if (trackerKey === d.id) return;
    trackerKey = d.id;
    const repo = untrack(() => (destination.type === 'integration' ? (destination.fields.repo as string | undefined) : undefined));
    void loadTracker(d.id, repo || undefined, true);
  });
  function pickRepo(repo: string) {
    if (destination.type !== 'integration') return;
    if ((trackerRepo ?? '') === repo) return;
    destination = { ...destination, fields: { ...destination.fields, repo: repo || undefined, labels: [], assignees: [], milestone: undefined } };
    void loadTracker(destination.integrationId, repo || undefined, false);
  }
  const toggleIn = (list: unknown, v: string) => {
    const l = (list as string[] | undefined) ?? [];
    return l.includes(v) ? l.filter((x) => x !== v) : [...l, v];
  };

  const wsItems = $derived(workspaces.map((w) => ({ value: w.id, label: w.name, checked: w.id === workspaceId, testid: `ws-${w.id}` })));
  const folderItems = $derived([
    { value: null as string | null, label: 'No folder', checked: !folderId, testid: 'folder-none' },
    ...folders.map((f) => ({ value: f.id as string | null, label: f.name, icon: 'folder' as const, checked: f.id === folderId, testid: `folder-${f.id}` })),
  ]);

  const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  void tick;
</script>

<svelte:window onkeydown={onKey} />

<div class="nb-ed-backdrop" class:nb-shown={shown} data-testid="editor-backdrop">
  <div class="nb-ed" role="dialog" aria-modal="true" aria-label="Capture draft" data-testid="editor" data-kind={kind}>
    <section class="nb-ed-media">
      {#if reopened}
        <button type="button" class="nb-ed-close nb-wide" data-testid="close" onclick={closeClick}>
          <EdIcon name="close" size={16} /> Save for later
        </button>
      {:else}
        <Tip label="Discard draft" placement="bottom">
          <button type="button" class="nb-ed-close" aria-label="Discard draft" data-testid="close" onclick={closeClick}>
            <EdIcon name="close" size={18} />
          </button>
        </Tip>
      {/if}

      <div class="nb-ed-preview">
        {#if loadError}
          <div class="nb-ed-msg">This draft could not be opened: {loadError}</div>
        {:else if !data}
          <div class="nb-ed-msg"><EdIcon name="spinner" size={20} /></div>
        {:else if ann && data.screenshotUrl}
          <Annotator state={ann} src={data.screenshotUrl} />
        {:else if trim}
          <VideoDraft
            bind:this={player}
            src={data.videoUrl}
            {trim}
            fallbackDurationMs={data.draft.durationMs}
            replayEvents={data.replayEvents ?? null}
            startedAt={data.startedAt ?? null}
            markers={data.markers ?? []}
            onthumb={thumb}
            placeholder={kind === 'replay' ? 'Nothing was recorded for this replay' : 'No video in this draft'}
          />
        {/if}
      </div>

      {#if ann}
        <div class="nb-ed-tools">
          {#if isArea && data?.fullUrl}
            <label class="nb-ed-full" data-testid="keep-full">
              <img src={data.fullUrl} alt="Full viewport" />
              <input type="checkbox" bind:checked={keepFull} data-testid="keep-full-check" />
              <span>Include the full page</span>
            </label>
          {/if}
          <ToolPill state={ann} />
        </div>
      {/if}
    </section>

    <section class="nb-ed-form">
      <div class="nb-ed-top">
        <Menu items={destItems} onpick={pickDest} label="Destination">
          {#snippet trigger({ toggle, open })}
            <button type="button" class="nb-ed-select nb-dest" aria-haspopup="menu" aria-expanded={open} data-testid="destination" onclick={toggle}>
              <EdIcon name={destIntegration ? destIcon(destIntegration.type) : 'link'} size={15} />
              <span class="nb-ellipsis">{destLabel}</span>
              <EdIcon name="chevron" size={14} />
            </button>
          {/snippet}
        </Menu>
        <Menu items={wsItems} onpick={(id) => void switchWorkspace(id)} label="Workspace" placement="bottom-end">
          {#snippet trigger({ toggle, open })}
            <Tip label={workspace ? `Workspace: ${workspace.name}` : 'Workspace'} placement="bottom">
              <button
                type="button"
                class="nb-ed-select nb-ws"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Workspace {workspace?.name ?? ''}"
                data-testid="workspace"
                disabled={workspaces.length === 0}
                onclick={toggle}
              >
                <span class="nb-avatar">{(workspace?.name ?? '?').slice(0, 1).toUpperCase()}</span>
                <EdIcon name="chevron" size={14} />
              </button>
            </Tip>
          {/snippet}
        </Menu>
      </div>

      {#if data}
        <RichField
          bind:this={field}
          value={text}
          {ai}
          aiAccepted={aiAccepted || !aiOn}
          onchange={(v) => (text = v)}
          onaccept={() => (aiAccepted = true)}
          onseek={(ms) => player?.seek(ms)}
          onsubmit={() => void create()}
        />
      {:else}
        <div class="nb-ed-fieldph"></div>
      {/if}

      {#if destination.type === 'integration' && destIntegration}
        <div class="nb-ed-fields" data-testid="dest-fields">
          {#if destIntegration.type === 'slack'}
            <label>
              <span>Message</span>
              <input type="text" placeholder="Optional note for the channel" value={(destination.fields.message as string) ?? ''} oninput={(e) => setField('message', e.currentTarget.value)} />
            </label>
          {:else}
            <label>
              <span>{destIntegration.type === 'gitlab' ? 'Project' : 'Repository'}</span>
              <input
                type="text"
                placeholder="owner/repo"
                list="nb-ed-repos"
                value={(destination.fields.repo as string) ?? ''}
                oninput={(e) => setField('repo', e.currentTarget.value)}
                onchange={(e) => pickRepo(e.currentTarget.value.trim())}
                data-testid="dest-repo"
              />
              <datalist id="nb-ed-repos">
                {#each trackerOpts?.repos ?? [] as r (r.id)}<option value={r.fullName}></option>{/each}
              </datalist>
            </label>
            {#if trackerLoading}<span class="nb-ed-note" data-testid="dest-loading">Loading from {trackerName}</span>{/if}
            {#if trackerErr}
              <p class="nb-ed-note nb-ed-warn" role="status" data-testid="dest-error">{trackerName} did not answer ({trackerErr}). Create still saves the capture and copies its link; filing the issue may fail.</p>
            {/if}
            {#if trackerOpts?.labels.length}
              <div class="nb-ed-flabel">Labels</div>
              <div class="nb-ed-chips" data-testid="dest-labels">
                {#each trackerOpts.labels as l (l.name)}
                  <button
                    type="button"
                    class:on={((destination.fields.labels as string[]) ?? []).includes(l.name)}
                    aria-pressed={((destination.fields.labels as string[]) ?? []).includes(l.name)}
                    onclick={() => setField('labels', toggleIn(destination.type === 'integration' ? destination.fields.labels : [], l.name))}
                    data-label={l.name}>
                    {#if l.color}<span class="nb-ed-dot" style="background:{l.color.startsWith('#') ? l.color : `#${l.color}`}"></span>{/if}{l.name}
                  </button>
                {/each}
              </div>
            {:else}
              <label>
                <span>Labels</span>
                <input
                  type="text"
                  placeholder="bug, ui"
                  value={((destination.fields.labels as string[]) ?? []).join(', ')}
                  oninput={(e) =>
                    setField(
                      'labels',
                      e.currentTarget.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )}
                  data-testid="dest-labels-text"
                />
              </label>
            {/if}
            {#if trackerOpts?.assignees.length}
              <label>
                <span>Assignee</span>
                <select value={((destination.fields.assignees as string[]) ?? [])[0] ?? ''} onchange={(e) => setField('assignees', e.currentTarget.value ? [e.currentTarget.value] : [])} data-testid="dest-assignee">
                  <option value="">Nobody</option>
                  {#each trackerOpts.assignees as a (a.login)}<option value={a.login}>{a.name ? `${a.name} (${a.login})` : a.login}</option>{/each}
                </select>
              </label>
            {/if}
            {#if trackerOpts?.milestones.length}
              <label>
                <span>Milestone</span>
                <select value={(destination.fields.milestone as string) ?? ''} onchange={(e) => setField('milestone', e.currentTarget.value || undefined)} data-testid="dest-milestone">
                  <option value="">None</option>
                  {#each trackerOpts.milestones as m (m.id)}<option value={m.id}>{m.title}</option>{/each}
                </select>
              </label>
            {/if}
          {/if}
        </div>
      {/if}

      {#if attachments.length}
        <ul class="nb-ed-atts" data-testid="attachments">
          {#each attachments as a (a.id)}
            <li>
              <EdIcon name={a.type.startsWith('image/') ? 'screenshot' : 'file-text'} size={14} />
              <span class="nb-ellipsis" title={a.name}>{a.name}</span>
              <span class="nb-faint">{fmtSize(a.size)}</span>
              <button type="button" aria-label="Remove {a.name}" onclick={() => removeAttachment(a.id)}><EdIcon name="close" size={12} /></button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="nb-ed-bottom">
        <Tip label="Attach files">
          <button type="button" class="nb-ed-icon" aria-label="Attach files" data-testid="attach" onclick={() => fileInput?.click()}>
            <EdIcon name="paperclip" size={17} />
          </button>
        </Tip>
        <input bind:this={fileInput} type="file" multiple hidden data-testid="attach-input" onchange={(e) => void addFiles(e.currentTarget.files)} />
        {#if folders.length}
          <Menu items={folderItems} onpick={(id) => (folderId = id)} label="Folder" placement="top-start">
            {#snippet trigger({ toggle, open })}
              <button type="button" class="nb-ed-chip" class:nb-set={!!folder} aria-haspopup="menu" aria-expanded={open} data-testid="folder" onclick={toggle}>
                <EdIcon name="folder" size={14} />
                <span class="nb-ellipsis">{folder?.name ?? 'Folder'}</span>
              </button>
            {/snippet}
          </Menu>
        {/if}
        <span class="nb-grow"></span>
        {#if aiFeature}
        <Tip label={aiDisabledReason ?? (aiOn ? 'AI draft on' : 'AI draft off')}>
          <button
            type="button"
            class="nb-ed-ai"
            role="switch"
            aria-checked={aiOn}
            aria-label="AI draft"
            disabled={!!aiDisabledReason}
            data-testid="ai-switch"
            onclick={toggleAi}
          >
            {#if aiLoading}<EdIcon name="spinner" size={14} />{:else}<EdIcon name="sparkle" size={14} />{/if}
            <span class="nb-track"><span class="nb-knob"></span></span>
          </button>
        </Tip>
        {/if}
        <button type="button" class="nb-ed-create" disabled={!data || creating} aria-busy={creating} data-testid="create" onclick={() => void create()}>
          {#if creating}<EdIcon name="spinner" size={15} />{/if}
          Create
        </button>
      </div>
    </section>
  </div>
  <Toaster position="bottom-right" />
</div>

<style>
  .nb-ed-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--nb-overlay);
    opacity: 0;
    transition: opacity 0.3s var(--nb-ease-out);
    font-family: var(--nb-font-sans);
    color: var(--nb-text);
  }
  .nb-ed-backdrop.nb-shown {
    opacity: 1;
  }
  .nb-ed {
    width: min(1380px, calc(100vw - 48px));
    height: min(730px, calc(100vh - 48px));
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(300px, 27%, 380px);
    border-radius: var(--nb-radius-xl);
    background: var(--nb-surface);
    box-shadow: var(--nb-shadow-lg);
    overflow: hidden;
  }
  .nb-ed-media {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 16px 20px 16px;
    min-width: 0;
    background: var(--nb-surface-2);
  }
  .nb-ed-close {
    all: unset;
    box-sizing: border-box;
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--nb-border-strong);
    border-radius: var(--nb-radius-md);
    background: var(--nb-surface);
    color: var(--nb-text);
    cursor: pointer;
    font: var(--nb-weight-medium) var(--nb-text-md) / 1 var(--nb-font-sans);
  }
  .nb-ed-close.nb-wide {
    width: auto;
    padding: 0 14px;
    align-self: flex-start;
  }
  .nb-ed-close:hover {
    background: var(--nb-surface-sunken);
  }
  .nb-ed-close:focus-visible,
  .nb-ed-select:focus-visible,
  .nb-ed-create:focus-visible,
  .nb-ed-icon:focus-visible,
  .nb-ed-chip:focus-visible,
  .nb-ed-ai:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 2px;
  }
  .nb-ed-preview {
    position: relative;
    flex: 1;
    min-height: 0;
    margin: 12px 0 0;
  }
  .nb-ed-media:has(.nb-ed-tools) .nb-ed-preview {
    margin-bottom: 64px;
  }
  .nb-ed-msg {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--nb-text-muted);
  }
  .nb-ed-tools {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }
  .nb-ed-tools > :global(*) {
    pointer-events: auto;
  }
  .nb-ed-full {
    position: absolute;
    bottom: 58px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 6px 6px;
    border-radius: var(--nb-radius-md);
    background: var(--nb-surface);
    border: 1px solid var(--nb-border);
    box-shadow: var(--nb-shadow-md);
    font-size: var(--nb-text-md);
    cursor: pointer;
  }
  .nb-ed-full img {
    width: 64px;
    height: 40px;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid var(--nb-border);
  }
  .nb-ed-full input {
    accent-color: var(--nb-accent);
    margin: 0;
  }
  .nb-ed-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    border-left: 1px solid var(--nb-border);
    min-width: 0;
  }
  .nb-ed-top {
    display: flex;
    gap: 8px;
  }
  .nb-ed-top > :global(:first-child) {
    flex: 1;
    min-width: 0;
  }
  .nb-ed-select {
    all: unset;
    box-sizing: border-box;
    height: 38px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border: 1px solid var(--nb-border-strong);
    border-radius: var(--nb-radius-md);
    background: var(--nb-surface);
    font: var(--nb-weight-medium) var(--nb-text-md) / 1 var(--nb-font-sans);
    cursor: pointer;
    min-width: 0;
  }
  .nb-ed-select:hover:not(:disabled) {
    background: var(--nb-surface-sunken);
  }
  .nb-ed-select:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .nb-dest {
    width: 100%;
  }
  .nb-dest .nb-ellipsis {
    flex: 1;
  }
  .nb-avatar {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--nb-accent);
    color: var(--nb-on-accent);
    font-size: var(--nb-text-sm);
    font-weight: var(--nb-weight-semibold);
  }
  .nb-ellipsis {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .nb-ed-fieldph {
    flex: 1;
  }
  .nb-ed-fields {
    display: grid;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--nb-border);
  }
  .nb-ed-fields label {
    display: grid;
    gap: 4px;
    font-size: var(--nb-text-sm);
    color: var(--nb-text-muted);
  }
  .nb-ed-fields select {
    height: 32px;
    padding: 0 6px;
    border: 1px solid var(--nb-border-strong);
    border-radius: var(--nb-radius-sm);
    background: var(--nb-surface);
    color: var(--nb-text);
    font: var(--nb-text-md) var(--nb-font-sans);
  }
  .nb-ed-note {
    margin: 0;
    font-size: var(--nb-text-sm);
    color: var(--nb-text-muted);
  }
  .nb-ed-warn {
    color: var(--nb-danger);
  }
  .nb-ed-flabel {
    font-size: var(--nb-text-sm);
    color: var(--nb-text-muted);
  }
  .nb-ed-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .nb-ed-chips button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: var(--nb-radius-pill);
    border: 1px solid var(--nb-border-strong);
    background: var(--nb-surface);
    color: var(--nb-text);
    font: var(--nb-text-sm) var(--nb-font-sans);
    cursor: pointer;
  }
  .nb-ed-chips button.on {
    border-color: var(--nb-accent);
    background: var(--nb-accent-tint);
    color: var(--nb-accent-text);
  }
  .nb-ed-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .nb-ed-fields input {
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--nb-border-strong);
    border-radius: var(--nb-radius-sm);
    background: var(--nb-surface);
    color: var(--nb-text);
    font: var(--nb-text-md) var(--nb-font-sans);
  }
  .nb-ed-atts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .nb-ed-atts li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: var(--nb-radius-sm);
    background: var(--nb-surface-sunken);
    font-size: var(--nb-text-sm);
  }
  .nb-ed-atts li .nb-ellipsis {
    flex: 1;
  }
  .nb-ed-atts button {
    all: unset;
    display: inline-flex;
    padding: 2px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--nb-text-muted);
  }
  .nb-faint {
    color: var(--nb-text-faint);
  }
  .nb-ed-bottom {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .nb-grow {
    flex: 1;
  }
  .nb-ed-icon {
    all: unset;
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--nb-radius-md);
    color: var(--nb-text-muted);
    cursor: pointer;
  }
  .nb-ed-icon:hover {
    background: var(--nb-surface-sunken);
    color: var(--nb-text);
  }
  .nb-ed-chip {
    all: unset;
    box-sizing: border-box;
    height: 30px;
    max-width: 150px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    border-radius: var(--nb-radius-pill);
    border: 1px dashed var(--nb-border-strong);
    color: var(--nb-text-muted);
    font: var(--nb-text-md) / 1 var(--nb-font-sans);
    cursor: pointer;
  }
  .nb-ed-chip.nb-set {
    border-style: solid;
    background: var(--nb-accent-tint);
    border-color: transparent;
    color: var(--nb-accent-text);
  }
  .nb-ed-ai {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    border-radius: var(--nb-radius-pill);
    color: var(--nb-text-muted);
    cursor: pointer;
  }
  .nb-ed-ai:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .nb-track {
    position: relative;
    width: 30px;
    height: 18px;
    border-radius: 9px;
    background: var(--nb-border-strong);
    transition: background var(--nb-dur-fast);
  }
  .nb-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--nb-shadow-sm);
    transition: transform var(--nb-dur-fast) var(--nb-ease-out);
  }
  .nb-ed-ai[aria-checked='true'] .nb-track {
    background: var(--nb-accent);
  }
  .nb-ed-ai[aria-checked='true'] .nb-knob {
    transform: translateX(12px);
  }
  .nb-ed-ai[aria-checked='true'] {
    color: var(--nb-accent-text);
  }
  .nb-ed-create {
    all: unset;
    box-sizing: border-box;
    height: 34px;
    min-width: 76px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 14px;
    border-radius: var(--nb-radius-md);
    background: var(--nb-accent);
    color: var(--nb-on-accent);
    font: var(--nb-weight-semibold) var(--nb-text-base) / 1 var(--nb-font-sans);
    cursor: pointer;
  }
  .nb-ed-create:hover:not(:disabled) {
    background: var(--nb-accent-hover);
  }
  .nb-ed-create:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
