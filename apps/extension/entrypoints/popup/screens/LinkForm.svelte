<script lang="ts">
  // Recording link from the popup (J-015, J-232): optional name, recorder domain (with its
  // status dot and menu), folder, create. The short link is copied at once and shown with a
  // copy button.
  import { onMount } from 'svelte';
  import { Button, Icon } from '@toolbar/ui';
  import { store } from '../lib/store.svelte';
  import { send, errorText } from '../../capture.content/ui/send';
  import ScreenHead from '../lib/ScreenHead.svelte';

  let name = $state('');
  let folderId: string | null = $state(null);
  let folders: { id: string; name: string }[] = $state([]);
  let domain = $state('');
  let workspaceId: string | null = $state(null);
  let domainMenu = $state(false);
  let creating = $state(false);
  let error = $state('');
  let url: string | null = $state(null);
  let copied = $state(false);
  let nameInput: HTMLInputElement | undefined = $state();

  onMount(() => {
    nameInput?.focus();
    void send('link.options', {}).then((r) => {
      if (!r.ok) return;
      folders = r.folders;
      domain = r.recorderDomain;
      workspaceId = r.workspaceId;
    });
  });

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const r = await send('clipboard.write', { text });
      if (!r.ok) return false;
    }
    copied = true;
    setTimeout(() => (copied = false), 2000);
    return true;
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    creating = true;
    error = '';
    const r = await send('link.create', { name: name.trim(), folderId, recorderDomain: domain || null, workspaceId: workspaceId ?? undefined });
    creating = false;
    if (!r.ok) {
      error = errorText(r);
      return;
    }
    url = r.link.url;
    await copy(url);
  }
</script>

<div data-screen="link">
  <ScreenHead title="New recording link" onback={() => (store.screen = 'main')} />
  {#if url}
    <div class="done" data-link-done>
      <p class="ok"><Icon name="check" size={16} /> {copied ? 'Link copied. Send it to anyone who should record.' : 'Link ready. Send it to anyone who should record.'}</p>
      <div class="url">
        <input readonly value={url} aria-label="Recording link" data-link-url />
        <Button variant={copied ? 'secondary' : 'primary'} size="md" icon={copied ? 'check' : 'copy'} onclick={() => copy(url!)} data-link-copy>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <button class="again" type="button" onclick={() => { url = null; name = ''; }}>Create another</button>
    </div>
  {:else}
    <form onsubmit={create}>
      <label>
        <span>Name <small>optional</small></span>
        <input type="text" maxlength="200" placeholder="Checkout bug reports" bind:value={name} bind:this={nameInput} data-link-name />
      </label>
      <div class="field">
        <span>Recorder domain</span>
        <div class="menu-wrap">
          <button type="button" class="select" aria-haspopup="menu" aria-expanded={domainMenu} data-link-domain onclick={() => (domainMenu = !domainMenu)}>
            <span class="dot" data-domain-status="default" title="Video and voice only"></span>
            <span class="grow">{domain || '...'}</span>
            <Icon name="chevron-down" size={14} />
          </button>
          {#if domainMenu}
            <div class="menu" role="menu" data-domain-menu>
              <button type="button" role="menuitemradio" aria-checked="true" onclick={() => (domainMenu = false)}>
                <Icon name="check" size={14} /><span>{domain}</span>
              </button>
              <p class="menu-note">Recordings on this domain have video and voice only, with no console or network capture.</p>
            </div>
          {/if}
        </div>
      </div>
      <label>
        <span>Folder</span>
        <select bind:value={folderId} data-link-folder>
          <option value={null}>No folder</option>
          {#each folders as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
        </select>
      </label>
      {#if error}<p class="err" role="alert" data-link-error>{error}</p>{/if}
      <div class="actions">
        <Button type="submit" variant="primary" loading={creating} data-link-create>Create link</Button>
      </div>
    </form>
  {/if}
</div>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  label,
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font: var(--nb-weight-medium) var(--nb-text-md) / 1.2 var(--nb-font-sans);
  }
  small {
    color: var(--nb-text-faint);
    font-weight: var(--nb-weight-normal);
  }
  input,
  select,
  .select {
    box-sizing: border-box;
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--nb-border-strong);
    border-radius: var(--nb-radius-md);
    background: var(--nb-surface);
    color: var(--nb-text);
    font: var(--nb-text-base) var(--nb-font-sans);
  }
  input,
  select,
  .select {
    transition:
      border-color var(--nb-dur-fast) var(--nb-ease-out),
      box-shadow var(--nb-dur-fast) var(--nb-ease-out);
  }
  input::placeholder {
    color: var(--nb-text-faint);
  }
  input:focus,
  select:focus,
  .select:focus-visible {
    outline: none;
    border-color: var(--nb-focus);
    box-shadow: var(--nb-focus-ring);
  }
  .select:hover,
  select:hover {
    background: var(--nb-surface-sunken);
  }
  .select {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    text-align: left;
  }
  .grow {
    flex: 1;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--nb-danger);
  }
  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 5;
    padding: 6px;
    border-radius: var(--nb-radius-lg);
    border: 1px solid var(--nb-border);
    background: var(--nb-surface-raised);
    color: var(--nb-text);
    box-shadow: var(--nb-shadow-lg);
  }
  .menu button {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    height: 28px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: var(--nb-radius-sm);
    cursor: pointer;
    font: var(--nb-text-md) var(--nb-font-sans);
  }
  .menu button:hover {
    background: var(--nb-surface-sunken);
  }
  /* keyboard focus for a control that `all: unset` left without a ring (D-181) */
  .menu button:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: -2px;
  }
  .again:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 2px;
    border-radius: 2px;
  }
  .menu-note {
    margin: 4px 8px 6px;
    color: var(--nb-text-muted);
    font: var(--nb-text-sm) / 1.35 var(--nb-font-sans);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .err {
    margin: 0;
    color: var(--nb-danger);
    font-size: var(--nb-text-md);
  }
  .done {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ok {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--nb-success);
    font-size: var(--nb-text-md);
  }
  .url {
    display: flex;
    gap: 8px;
  }
  .url input {
    font: var(--nb-text-md) var(--nb-font-mono);
  }
  .again:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .again {
    all: unset;
    align-self: flex-start;
    color: var(--nb-accent-text);
    font: var(--nb-weight-medium) var(--nb-text-md) / 1 var(--nb-font-sans);
    cursor: pointer;
  }
</style>
