<script lang="ts">
  // Privacy policy for this server and the browser extension that talks to it. The Chrome Web
  // Store asks for a policy URL because the extension handles page content.
  import { page } from '$app/state';
  import BrandMark from '#lib/components/BrandMark.svelte';
  const brandName = $derived(page.data.brand?.name ?? 'open-toolbar');
  const host = $derived(page.url.host);
</script>

<svelte:head><title>Privacy · {brandName}</title></svelte:head>

<main class="policy">
  <div class="brand"><BrandMark size={24} /> {brandName}</div>
  <h1>Privacy policy</h1>
  <p class="lede">
    {brandName} is open-source software (MIT) that an organisation runs on its own server. This page covers the
    server at <b>{host}</b> and the {brandName} browser extension when it is connected to it. Nobody sells this
    software, and nothing you record is used for advertising.
  </p>

  <h2>What the extension records</h2>
  <p>Only when you start a capture, a trace or a comment, and only on sites your workspace has added to a project and that you allowed in Chrome:</p>
  <ul>
    <li>screenshots and video of the tab or screen you choose, and voice notes if you turn the microphone on;</li>
    <li>the page's structure (a DOM recording), the page address and title, and your clicks, typing and scrolling on that page;</li>
    <li>console messages, errors and network requests the page makes, with request and response details;</li>
    <li>your comments, highlights and drawings, and basic browser and device details (browser version, screen size, language).</li>
  </ul>
  <p>
    Before anything leaves your browser, the extension removes passwords, authorization headers, cookies, API keys,
    tokens and card numbers. Under the production masking preset it also masks page text and form fields.
  </p>

  <h2>Where it goes</h2>
  <p>
    Everything is sent only to this server, which your organisation operates. The server stores it in its own
    database and file storage. It is not sent to the authors of {brandName} or to any other company, with one
    exception: if an administrator turns on hosted transcription, voice-note audio is sent to the speech-to-text
    provider the administrator chose, only to produce a transcript.
  </p>

  <h2>Who can see it</h2>
  <p>
    People in your workspace, people you share a link with (share links expire), and coding agents your
    organisation connects through the server's API or MCP endpoint with a personal token.
  </p>

  <h2>Sign-in</h2>
  <p>
    You sign in through your organisation's identity provider. The server keeps your name, email address and the
    provider's account identifier to show who left each piece of feedback.
  </p>

  <h2>Keeping and deleting data</h2>
  <p>
    Captures stay until you or an administrator delete them. Deleting a capture removes its recordings and files
    from this server. Signing out of the extension removes its stored sign-in; uninstalling it removes everything it
    kept in the browser.
  </p>

  <h2>Contact</h2>
  <p>Questions about this server go to its administrators at your organisation.</p>
</main>

<style>
  .policy {
    max-width: 44rem;
    margin: 0 auto;
    padding: var(--nb-space-12, 48px) var(--nb-space-6, 24px);
    color: var(--nb-text-body, var(--nb-text));
    line-height: 1.625;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--nb-text);
    margin-bottom: var(--nb-space-8, 32px);
  }
  h1 {
    font-family: var(--nb-font-display, inherit);
    color: var(--nb-text);
    font-size: 30px;
    letter-spacing: -0.025em;
    margin: 0 0 16px;
  }
  h2 {
    color: var(--nb-text);
    font-size: 18px;
    margin: 32px 0 8px;
  }
  .lede {
    font-size: 16px;
  }
  ul {
    padding-left: 20px;
  }
</style>
