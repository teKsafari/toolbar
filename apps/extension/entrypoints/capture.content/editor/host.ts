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
  'color-scheme:normal',
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
    } else if (m.type === 'close') {
      const id = draftId;
      close();
      ensureToaster();
      if (m.reason === 'created') toasts.success('Link copied. The capture opened in a new tab.');
      else if (m.reason === 'saved' && id)
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
