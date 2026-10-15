<script lang="ts">
	import { page } from '$app/state';
</script>

<main>
	<section>
		<h1>Item {page.params.id}</h1>
		<p>A route with a parameter, for source location tests.</p>
		<button data-testid="item-buy" class="buy">Buy item {page.params.id}</button>
	</section>
</main>
