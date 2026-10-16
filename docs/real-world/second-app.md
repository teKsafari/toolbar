# Real-world test 2: IdrisElectro store (SvelteKit 1)

PLAN "Part 2, step 5", item 2: open-toolbar on a second app of the owner's with a structure unlike Nuru's. Run on 2026-10-16 with the release extension and with the injector, against a real app that was not changed.

## Which app and why

`Heracraft/csds221-pr03`, the `store/` folder: "IdrisElectro", an electronics shop the owner built with SvelteKit and Sanity Studio. Commit `ab71fd1`.

| | Nuru | IdrisElectro store |
|---|---|---|
| Framework | Next.js 15, React | SvelteKit 1.x, Svelte 3, Vite 4 |
| Data | its own API, a WASM interpreter | Sanity (GROQ) in `+page.server.js` loads, Firebase on the client |
| Where it ran | deployed, https://116.nuru.sh | `vite dev` on this machine, :5290 |

The owner's other Svelte repos either need paid or private services (`happa.io` and `BTC` need Firebase admin keys and Neon), carry no server loads (`herakraft` is one status page) or are the same store again (`idri`). The store's Sanity dataset `s02bznjg/production` answers public reads, so it runs with no secrets: `.env` holds the project id and an empty write token. Writes (orders, reviews) then fail, as they would for any visitor without the token. It has server loads on six routes, client-side navigation with `__data.json`, a JSON `POST` endpoint and one unused form action, so it exercises the SvelteKit side of the trace engine and the locator on a Svelte 3 dev server, which the lab (Svelte 5) does not.

Setup, with no change to the app's code: `npm ci`, then `npm install --no-save sass` (the app's own bug 9 below), `vite dev --port 5290 --host 0.0.0.0` as a user service with `Restart=always` (bug 1 kills it).

## How the review ran

Chromium 153 (Playwright 1.63.0) on Xvfb `:261` with openbox, the release build of the extension (`apps/extension/.output/chrome-mv3`, copied to `chrome-mv3-261`), signed in through the popup with Dev SSO as `kim@idri.test` against the compose stack on :3000. A project "IdrisElectro store" for `http://localhost:5290` (staging preset), allowed from the popup: Chrome granted `http://localhost:5290/*` and the server, nothing else. The popup shortcut, the address bar and Chrome's permission prompt went through xdotool; page clicks, typing and drawing through the mouse and keyboard at reading speed. The closed shadow root was read through CDP `DOM.getDocument` with `pierce`, the way a person reads the screen, to know which tool was armed. Fake microphone: an espeak-ng clip of the reviewer's complaint. Transcription was the stack's local whisper.cpp, so no OpenAI spend.

About 16 minutes of reviewing in all: one comment without a trace, one 11 min 26 s trace with six notes, a second comment after the fixes, then the injector path. Scripts and screenshots stay on this machine in `/home/dev/second-app-review/` (not in git).

## Captures and folders

Pulled with the share page's command, `curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "<server>/api/v1/recordings/<id>/folder" | tar xz`:

| Capture | What | Folder |
|---|---|---|
| `01a144f7-5c4e-7547-b121-4687e790dfb3` | Comment without a trace: element comment on a price, with the last 60 s | `/home/dev/second-app/.feedback/01a144f7-5c4e-7547-b121-4687e790dfb3/` |
| `01a144f7-bc0b-7fdc-b0c0-35d1afbd3fbe` | Trace, 11:26: search, sort, product, cart, checkout, place order, orders page, a mistyped product link. 52 spans (32 changed, 11 dead, 1 error, 1 silent, 7 notes), six notes a01 to a06: rectangle, text highlight, element screenshot, freehand, voice note, element comment. 64 files, README 18.7k characters | `/home/dev/second-app/.feedback/01a144f7-bc0b-7fdc-b0c0-35d1afbd3fbe/` |
| `01a14516-2c11-7b61-bb1c-08a80a1373e2` | Comment on the checkout's Address field, made with the fixed extension (locator check) | `/home/dev/second-app/.feedback/01a14516-2c11-7b61-bb1c-08a80a1373e2/` |
| `01a14508-02c8-7c78-bd10-d97002aad6c3` | Injector: comment without a trace (server on :3361) | `/home/dev/second-app/injector/.feedback/01a14508-02c8-7c78-bd10-d97002aad6c3/` |
| `01a14516-cfb1-713c-9ef1-0d5e20ccfc0c` | Injector: trace over search, product, cart, checkout and place order, through the dev server's crash, with the fixed page bundle | `/home/dev/second-app/injector/.feedback/01a14516-cfb1-713c-9ef1-0d5e20ccfc0c/` |

## Bugs found in the app

Each one with the capture that shows it and the cause, found by reading the store's code after the capture pointed at it. Nothing was changed in the store's repository.

1. **Place order says the order was placed, but no order exists, and the dev server dies.** `src/routes/cart/+server.js` calls `client.create(...)` without `await` and returns `new Response({status: 200, message: "Order created"})`, a 200 whose body is the text `[object Object]`. The page sees 200 and shows "Order placed successfully". The create then fails (`Insufficient permissions; permission "create" required`) as an unhandled rejection, which ends the Node process; on Netlify it would fail quietly. The `catch` calls `error({status, body})`, which is not a function there. Trace `01a144f7-bc0b...` span s045 (`silent network: POST /cart 200, GET / net::ERR_CONNECTION_REFUSED`), voice note a05, keyframes k08 and k09; injector trace `01a14516-cfb1...` span s021 (`silent 5xx`).
2. **No sort changes the search results.** The hero and navbar searches send `sort=asc` or `sort=desc`; `src/routes/search/+page.server.js` only knows `tdsc`, `pasc`, `pdsc` and `rdsc`, and `pasc`, `pdsc` and `rdsc` fall through for want of `break`, so every sort becomes `order(_createdAt desc)`. The query also slices `[0..20]` before it orders, and `rate && title match q || description match q && category` binds as `(rate && title) || (description && category)`. The side panel's "Price:Low to High" only sets a store value. `q` goes into the GROQ string unescaped. Trace a01 (rectangle over 1,000,000 / 1,892,032 / 1,513,152 after "Price: Low to High").
3. **"Over 5 results for laptop" when exactly five show**, and a sort the shopper never picked in the URL. `src/routes/search/+page.svelte`. Trace a02.
4. **Product details: "Dimensions (cm): 5 in x 5 in" and "6 oz" for a 14 inch laptop.** The label says cm, the data says inches, and the numbers are placeholder content in Sanity. Trace a03 (element screenshot; the locator points at `src/routes/buy/[id]/+page.svelte` line 94, the `{data.dimensions}` paragraph).
5. **The same product added twice makes two cart rows of quantity 1.** Both "Add to Cart" buttons append to `cartItems` without looking for the product. Code reading also shows the Remove handler in `src/routes/cart/item.svelte` calls `splice(index, index + 1)`, which removes more than one row for any row after the first. Trace a04 (freehand around the two rows).
6. **A mistyped product link gives a bare "500: Internal Error".** `src/routes/buy/[id]/+page.server.js` reads `content[0].mainImage` before it checks that anything came back, and the `throw error(404)` at the end would fail anyway: `error` is never imported. The home page's loader has the same missing import. Trace a06, span s051.
7. **Galaxy Z Flip 3 at TSh 7,104, cheaper than a Nokia 225 at TSh 127,872.** A Sanity data error, a factor of about 1000. Comment `01a144f7-5c4e...` a01, and the injector comment `01a14508-02c8...`.
8. **The checkout's Address field says "Enter your phone number"**, and its label, like the phone field's and the city's, points at `id="user"`. `src/routes/cart/checkout.svelte` line 125. Comment `01a14516-2c11...` a01.
9. **A fresh clone does not start.** `package.json` lacks `sass`, which the `<style lang="scss">` blocks need: every page answers 500 with "Preprocessor dependency "sass" not found" (the `idri` copy of the store lists it). Found at setup.
10. **"Your Orders: 8 orders placed" for a signed-out shopper**, one card of TSh 4,002 dated today, and never the order just placed: `src/routes/user/orders/+page.svelte` is a fixed placeholder (`let total = 4002`). Trace s049.
11. **Firebase is a placeholder config** (`// TOD: REPLACE WITH YOUR FIREBASE CONFIG` in `src/js/firebase.js`): every product page logs `Firestore ... permission-denied` and reviews and sign-in cannot work. Trace s026 (`error`), and the 60 s context of a03.

Also seen, not counted: "Proceeed to checkout" (typo), `<Ratings> was created without expected prop 'badge'` and `<Stepper> was created with unknown prop '$currentStep'` warnings, and Google Tag Manager loading on a dev server.

## What worked

- Zero integration on an app the tool had never seen: one project, one Allow, and the extension recorded only on `http://localhost:5290`.
- Every reviewer tool on a real page, in the release build: element comment, text highlight (`t` after a drag), rectangle, freehand, element screenshot, voice note on the trace, comment without a trace with the Send button, Start and Stop trace from the popup and the `x` key. Notes followed the trace across client-side and full page loads.
- The span engine found the app's central bug on its own: Place order is `silent` with the 200 it got, and the README puts it under "What did not happen". The voice transcript (whisper.cpp, local) says the same in the reviewer's words.
- SvelteKit loads are named on a Kit 1 app: `SvelteKit load /search ... 200 -> went to /search/?q=laptop&sort=desc`.
- `__svelte_meta` on Svelte 3: the locator gave the exact file and line for each note (`src/lib/product.svelte`, `src/routes/buy/[id]/+page.svelte:94`, `src/routes/cart/checkout.svelte:125`, `src/routes/+error.svelte`), with Svelte 3's zero-based lines turned into one-based ones.
- Console stacks of the Firestore errors mapped to `@firebase/logger/src/logger.ts:115` through the dev server's source maps.
- The injector in front of the store (`apps/injector` image at HEAD, its own compose project on :3562, a dev server of open-toolbar on :3361 with `INJECTOR_SECRET`): no toolbar without the reviewer cookie, `/__toolbar/login` through Dev SSO, the toolbar in `<head>` after sign-in, Vite's HMR WebSocket proxied, a comment with the last minute and the locator, and a trace that followed the reviewer across pages and through the store's crash and Chrome's 502 page.

## What open-toolbar missed, and what changed (D-186)

Fixed on main, with tests:

1. **The locator lost the route table and called the dev server production on SvelteKit 1.** Kit 1 puts its start script, `import("/@fs/.../.svelte-kit/generated/client/app.js")`, inside the body that Svelte 3 hydrates, and Svelte 3 hydration removes nodes it did not render. By the time a reviewer clicked, the script was gone: no route dictionary (`routeFiles` had guesses such as `src/routes/buy/[buyId]/+page.svelte`) and `framework.dev: false`. `findKitEntries` now also reads the page's resource timeline, `viteDevPage` checks it for `/@vite/client`, and `__sveltekit_dev` marks dev. After the fix, comment `01a14516-2c11...` has `dev: true` and `source: manifest` entries. Tests: `packages/capture/test/locator.test.ts`.
2. **An injector trace could not be sent after a page went away mid-flush.** On `pagehide` the page bundle took the next chunk number, then had to gzip before it could send; the page died first, the number was never filled, and Stop got `stream_incomplete`: three traces stayed `uploading` (`01a14508-1531...`, `01a14509-e6a1...`, `01a1450b-ae31...`, chunks 11 and 12 missing in each). Now the unsent rows wait in `sessionStorage` for the next page of the tab (up to 2 MB), and Stop fills any chunk the server still lacks with an empty one and takes the server's byte count. After the fix the same flow sent `01a14516-cfb1...` with chunks 0 to 15. Tests: `apps/extension/test/page-session.test.ts`.
3. **The trace badge disappeared after a full page load.** Chrome clears a tab's own action badge when the tab loads a new document; the "TR" badge was set once at Start. The trace controller sets it again on each load of the traced tab. Test: `e2e/tests/trace/trace.spec.ts` "the trace badge stays on the tab across a full page load" (fails without the fix).
4. **Long request URLs pushed the navigation and the outcome off the README line.** s026 read `Click "Acer Swift 3 ..." -> GET /favicon.png 200, POST /google.firestore.v1.Firestore/Listen/channel?VER=8&database=...…` and never said it went to the product page or that it ended in `error`. Span summaries now fit the 240-character line: requests shrink first, down to a count. Tests: `packages/trace/test/engine.test.ts`.
5. **Every client-side navigation was labelled "(invalidated)".** SvelteKit sends `x-sveltekit-invalidated` on navigations and preloads too, with one flag per layout and page node. The label now says what the flags say, `SvelteKit load /search (1 of 2 server loads)`, and nothing when every load ran. Tests: `packages/trace/test/classify.test.ts`.

Not fixed, for later:

- **Link preloads.** The store preloads `__data.json` when the mouse passes over a product link (`/buy/Vg3h.../__data.json` several times while the reviewer drew over the result cards). The data lands in whatever span is open, and the click that uses it shows no request (s026). A request alone cannot tell a preload from a navigation.
- **Form actions were not exercised.** The store's only action, `cart?/checkout`, is never posted; orders go through a JSON `POST /cart` to `+server.js`, which the timeline names as `POST /cart`. Form action names stay covered by `packages/trace` tests and the lab.
- **Server files are guessed as TypeScript.** The packet lists `src/routes/cart/+page.server.ts` for a JavaScript app whose file is `+page.server.js`; the route table says a server load exists, not its extension.
- **Clicks on an invisible full-page element** are labelled with the start of the whole page's text (`Click "Login Home Your orders About English (US) Settings 1 Pers..."`): the store's mobile drawer covers the page. A selector would say more.
- **Drawings stay on the URL, not on the step.** The cart and the checkout share `/cart`; the freehand around the cart rows stayed over the checkout form.
- **The toolbar pill covers the store's bottom-right toast** ("Item added to cart"). The dock can move to another corner.
- **Injector traces whose tab closes before Stop** are never finalized and the draft sweep deletes them after 7 days. When the app is down the injector answers an empty 502, so the reviewer sees Chrome's error page without the toolbar until they reload.
- The fake microphone loops its file, so whisper's transcript ends with the clip's first words again; that is the test rig, not the product.
