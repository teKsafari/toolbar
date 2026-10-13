<script lang="ts">
	let clicks = $state(0);
</script>

<p>Inside the iframe.</p>
<button
	onclick={() => {
		clicks++;
		console.log('iframe button clicked', clicks);
		fetch('/api/ok?q=iframe');
	}}>Iframe button ({clicks})</button
>
