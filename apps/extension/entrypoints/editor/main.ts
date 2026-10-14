// Editor page (J-037): loaded in an iframe that the content script puts over the page, or as a
// tab of its own (tests, and pages where the frame cannot load). `?draft=<id>` names the draft.
import { mount } from 'svelte';
import '@toolbar/ui/tokens.css';
import './editor.css';
import { Editor } from '@toolbar/ui/editor';
import { EDITOR_FRAME_TAG } from '@toolbar/shared/ext';
import { createHost } from './host';

const draftId = new URLSearchParams(location.search).get('draft') ?? '';
const host = await createHost(draftId);
mount(Editor, { target: document.getElementById('app')!, props: { host } });
if (window.parent !== window) window.parent.postMessage({ [EDITOR_FRAME_TAG]: true, type: 'ready' }, '*');
