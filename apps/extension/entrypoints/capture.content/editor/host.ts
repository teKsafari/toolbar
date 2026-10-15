// In-page host for the draft editor (J-037). On `ui.editor-open` it puts the extension's editor
// page in a full-viewport iframe inside <toolbar-root>'s shadow root: the page's CSS cannot reach
// it, it reads drafts from the extension's IndexedDB directly, and its keys stay inside it.
// The page behind stays scrollable (J-216: match; decisions.md).
import { mount, unmount } from 'svelte';
import { browser } from 'wxt/browser';
import { Toaster, toasts } from '@toolbar/ui';
import { EDITOR_FRAME_TAG, isEditorFrameMessage, type ContentCommand } from '@toolbar/shared/ext';
import { EDITOR_PAGE } from '@toolbar/shared/areas/editor';

const FRAME_CSS = [
  'position:fixed',
  'inset:0',
  'width:100vw',
  'height:100vh',
  'border:0',
  'margin:0',
  'padding:0',
  'background:transparent',
  // Must match the editor document's color-scheme (light dark). When the frame element's used
  // scheme differs from the document's, Chrome paints the frame opaque and hides the page.
  'color-scheme:light dark',
  'pointer-events:auto',
  'z-index:2147483646',
  'display:block',
].join(';');

export interface EditorHostHandle {
  open(draftId: string): void;
  close(): void;
  readonly draftId: string | null;
  destroy(): void;
}

/**
 * Install the editor host in the toolbar's shadow-root container. One import and one call in
 * capture.content/index.ts. Toasts after the editor closes (created, saved for later) render in
 * the same container.
 */
export function installEditorHost(container: HTMLElement): EditorHostHandle {
  let frame: HTMLIFrameElement | null = null;
  let draftId: string | null = null;
  let toaster: ReturnType<typeof mount> | null = null;
  /** the progress toast of a create in flight (J-086) */
  let creating: number | null = null;
  const doneCreating = () => {
    if (creating !== null) toasts.dismiss(creating);
    creating = null;
  };

  const ensureToaster = () => {
    if (toaster || container.querySelector('.nb-toaster')) return;
    const box = document.createElement('div');
    box.setAttribute('data-nb-editor-toasts', '');
    box.style.cssText = 'pointer-events:auto';
    container.appendChild(box);
    toaster = mount(Toaster, { target: box, props: { position: 'bottom-right' } });
  };

  function open(id: string) {
    if (frame && draftId === id) return;
    close();
    draftId = id;
    frame = document.createElement('iframe');
    frame.src = browser.runtime.getURL(`${EDITOR_PAGE}?draft=${encodeURIComponent(id)}` as '/editor.html');
    frame.setAttribute('allow', 'clipboard-write');
    frame.setAttribute('title', 'Capture draft');
    frame.setAttribute('data-nb-editor', id);
    frame.style.cssText = FRAME_CSS;
    container.appendChild(frame);
  }

  function close() {
    frame?.remove();
    frame = null;
    draftId = null;
  }

  const onMessage = (e: MessageEvent) => {
    if (!frame || e.source !== frame.contentWindow || !isEditorFrameMessage(e.data)) return;
    const m = e.data;
    if (m.type === 'ready') {
      frame.focus();
    } else if (m.type === 'creating') {
      ensureToaster();
      // the toaster sits above the editor frame (z-index 2147483646) while the editor is open
      for (const el of container.querySelectorAll<HTMLElement>('.nb-toaster')) el.style.zIndex = '2147483647';
      doneCreating();
      creating = toasts.loading('Making the link...');
    } else if (m.type === 'create-failed') {
      doneCreating();
    } else if (m.type === 'close') {
      const id = draftId;
      close();
      ensureToaster();
      if (m.reason === 'created') {
        // J-089: with open-in-new-tab off nothing opens; J-140: a tracker failure still saved the capture
        const opened = m.opened !== false;
        const done = m.copied === false
          ? opened ? 'Capture created. It opened in a new tab; copy the link there.' : 'Capture created. Copy its link from your captures.'
          : opened ? 'Link copied. The capture opened in a new tab.' : 'Link copied.';
        // the progress toast turns into the done toast in place (J-086)
        if (creating !== null) toasts.update(creating, { kind: 'success', message: done });
        else toasts.success(done);
        creating = null;
        if (m.issueError) toasts.error(`The capture is saved, but filing the issue failed: ${m.issueError}`, { duration: 10_000 });
      } else doneCreating();
      if (m.reason === 'saved' && id)
        toasts.show('Saved to your drafts', {
          duration: 6000,
          action: { label: 'View', run: () => void browser.runtime.sendMessage({ type: 'draft.open', draftId: id }) },
        });
    }
  };
  window.addEventListener('message', onMessage);

  const onCommand = (msg: ContentCommand) => {
    if (msg?.type === 'ui.editor-open') open(msg.draftId);
    else if (msg?.type === 'ui.editor-close') close();
  };
  browser.runtime.onMessage.addListener(onCommand);

  return {
    open,
    close,
    get draftId() {
      return draftId;
    },
    destroy() {
      close();
      window.removeEventListener('message', onMessage);
      browser.runtime.onMessage.removeListener(onCommand);
      if (toaster) void unmount(toaster);
    },
  };
}

void EDITOR_FRAME_TAG;
