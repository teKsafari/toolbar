<script lang="ts">
	const rows = Array.from({ length: 500 }, (_, i) => ({
		id: i + 1,
		title: `Item ${i + 1}`,
		price: ((i * 37) % 200) + 0.99
	}));
	let selected = $state<number | null>(null);
</script>

<h1>Long list</h1>
<p class="muted">500 rows. Click a row to select it.</p>
<ul>
	{#each rows as row (row.id)}
		<li class:sel={selected === row.id}>
			<button class="rowbtn" onclick={() => (selected = row.id)}>{row.title}</button>
			<span>${row.price.toFixed(2)}</span>
		</li>
	{/each}
</ul>

<style>
	ul {
		list-style: none;
		padding: 0;
	}
	li {
		display: flex;
		justify-content: space-between;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid #eee;
	}
	li.sel {
		background: #fff4c2;
	}
	.rowbtn {
		background: none;
		border: none;
		padding: 0;
	}
</style>
