<script lang="ts">
	import { onDestroy } from 'svelte';

	let wsLog = $state<string[]>([]);
	let sseLog = $state<string[]>([]);
	let ws: WebSocket | null = null;
	let es: EventSource | null = null;
	let msg = $state('hello');

	function connectWs() {
		ws?.close();
		ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
		ws.onopen = () => (wsLog = [...wsLog, 'open']);
		ws.onmessage = (e) => (wsLog = [...wsLog, `in: ${e.data}`]);
		ws.onclose = () => (wsLog = [...wsLog, 'closed']);
	}

	function send() {
		ws?.send(JSON.stringify({ type: 'say', text: msg }));
		wsLog = [...wsLog, `out: ${msg}`];
	}

	function connectSse() {
		es?.close();
		es = new EventSource('/api/sse');
		es.addEventListener('tick', (e) => (sseLog = [...sseLog, (e as MessageEvent).data]));
		es.onerror = () => {
			sseLog = [...sseLog, 'stream ended'];
			es?.close();
		};
	}

	onDestroy(() => {
		ws?.close();
		es?.close();
	});
</script>

<h1>WebSocket and server-sent events</h1>
<section class="card">
	<h2>WebSocket</h2>
	<div class="row">
		<button data-testid="ws-connect" onclick={connectWs}>Connect</button>
		<input bind:value={msg} aria-label="Message" />
		<button data-testid="ws-send" onclick={send}>Send</button>
		<button onclick={() => ws?.close()}>Close</button>
	</div>
	<pre>{wsLog.slice(-12).join('\n')}</pre>
</section>
<section class="card">
	<h2>Server-sent events</h2>
	<div class="row">
		<button data-testid="sse-connect" onclick={connectSse}>Start stream</button>
		<button onclick={() => es?.close()}>Stop</button>
	</div>
	<pre>{sseLog.slice(-12).join('\n')}</pre>
</section>
