# @open-toolbar/embed

The open-toolbar reviewer toolbar on your own site, for reviewers who cannot install the browser
extension. Reviewers comment on elements, highlight text, draw, attach element screenshots and voice
notes, and record traces. Their notes go to your open-toolbar server, into the project the key
belongs to. Reviewers need no account; they can give a name.

## Get a key

On your open-toolbar server, open Settings, Projects, pick the project and create an embed key
(`tbk_...`). The key only works on the project's origins. It is public, like an analytics id.

## Script tag

Put it first in `<head>`, so it sees the console and network from the start:

```html
<script src="https://toolbar.example.com/embed.js" data-key="tbk_..."></script>
```

`data-name` and `data-email` name the reviewer when your app knows them.

## Package

```sh
npm i https://toolbar.example.com/embed/open-toolbar-embed.tgz
```

```ts
import { init } from '@open-toolbar/embed';
init({ key: 'tbk_...', server: 'https://toolbar.example.com', user: { name: 'Ada' } });
```

React:

```tsx
import { OpenToolbar } from '@open-toolbar/embed/react';
<OpenToolbar siteKey="tbk_..." server="https://toolbar.example.com" />;
```

`init` does nothing during server rendering and inside iframes, and runs once per page.

## Show and hide

The toolbar's X closes it on the site for that browser. Add `?open-toolbar` to a page URL, or call
`window.openToolbar.show()`, to bring it back; `window.openToolbar.hide()` closes it.

## Content Security Policy

Allow the server in `script-src` (script tag), `connect-src` and `font-src`, and `data:` and `blob:`
in `img-src` for screenshots. Styles use constructed style sheets, so `style-src` needs no
`'unsafe-inline'`.
