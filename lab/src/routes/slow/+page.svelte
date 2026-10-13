<script lang="ts">
	let { data } = $props();
</script>

<h1>Slow page</h1>
<p>{data.quick}</p>
{#await data.late}
	<p class="muted">Loading the rest...</p>
{:then late}
	<ul>
		{#each late.rows as row}<li>{row}</li>{/each}
	</ul>
{/await}
<p><a href="/slow-raw" data-sveltekit-reload>Plain streamed HTML (no SvelteKit)</a></p>
