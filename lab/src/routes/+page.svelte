<script lang="ts">
	let status = $state('idle');
	let saved = $state(0);
	let modalOpen = $state(false);

	async function works() {
		status = 'loading';
		const res = await fetch('/api/ok?q=works');
		const body = await res.json();
		saved++;
		status = `saved at ${body.at}`;
	}

	async function hangs() {
		status = 'loading';
		// Never resolves: the server holds the request open.
		await fetch('/api/hang');
		status = 'done';
	}

	async function hiddenFailure() {
		status = 'saving';
		try {
			const res = await fetch('/api/fail', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ item: 'lab-42', qty: 3 })
			});
			await res.json();
		} catch {
			// swallowed on purpose
		}
		// Bug on purpose: the UI ignores res.ok and shows success.
		status = 'saved';
	}

	function throws() {
		const user = undefined as unknown as { profile: { name: string } };
		console.log('about to read profile name');
		return user.profile.name;
	}

	function rejects() {
		Promise.reject(new Error('unhandled rejection from the lab app'));
	}

	function logAll() {
		console.log('log: plain string', 42, true);
		console.info('info: object', { user: { id: 7, roles: ['admin', 'editor'] }, at: new Date() });
		console.warn('warn: deprecated call', ['a', 'b', 'c']);
		console.error('error: with stack', new Error('lab error object'));
		console.debug('debug: nested', { a: { b: { c: { d: 'deep' } } } });
		console.table([
			{ id: 1, name: 'one' },
			{ id: 2, name: 'two' }
		]);
		console.group('group');
		console.log('inside group');
		console.groupEnd();
		console.trace('trace: call site');
		console.assert(false, 'assert: failed assertion');
		console.count('count');
		console.count('count');
		console.time('timer');
		console.timeEnd('timer');
	}
</script>

<h1>Buttons</h1>
<p>Status: <output data-testid="status">{status}</output> · saved {saved} times</p>

<section class="card">
	<h2>Requests and errors</h2>
	<div class="row">
		<button data-testid="works" onclick={works}>Save (works)</button>
		<button data-testid="dead">Export (does nothing)</button>
		<button data-testid="hangs" onclick={hangs}>Sync (never returns)</button>
		<button data-testid="hidden-500" onclick={hiddenFailure}>Submit order (hidden 500)</button>
		<button data-testid="throws" onclick={throws}>Show profile (throws)</button>
		<button data-testid="rejects" onclick={rejects}>Refresh (unhandled rejection)</button>
	</div>
</section>

<section class="card">
	<h2>Console</h2>
	<div class="row">
		<button data-testid="console" onclick={logAll}>Log at every level</button>
	</div>
</section>

<section class="card">
	<h2>Modal</h2>
	<button data-testid="open-modal" onclick={() => (modalOpen = true)}>Open modal</button>
</section>

<section class="card">
	<h2>Cross-origin image</h2>
	<img src="http://localhost:5174/badge.svg" alt="Badge served from port 5174" width="240" height="80" />
</section>

<section class="card">
	<h2>Iframe</h2>
	<iframe src="/embed" title="Embedded lab page" width="100%" height="160"></iframe>
</section>

{#if modalOpen}
	<div class="backdrop" role="presentation" onclick={() => (modalOpen = false)}></div>
	<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
		<h2 id="modal-title">Delete project?</h2>
		<p>This removes the project and its 12 recordings.</p>
		<div class="row">
			<button onclick={() => (modalOpen = false)}>Cancel</button>
			<button
				onclick={() => {
					console.warn('delete clicked in modal');
					modalOpen = false;
				}}>Delete</button
			>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.4);
	}
	.modal {
		position: fixed;
		top: 30%;
		left: 50%;
		translate: -50% 0;
		background: #fff;
		padding: 1.25rem;
		border-radius: 8px;
		max-width: 90vw;
	}
	iframe {
		border: 1px dashed #aaa;
	}
</style>
