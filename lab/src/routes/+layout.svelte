<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';

	let { children } = $props();

	const links = [
		['/', 'Buttons'],
		['/form', 'Form'],
		['/list', 'Long list'],
		['/canvas', 'Canvas'],
		['/live', 'WebSocket and SSE'],
		['/slow', 'Slow page']
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Lab{page.route.id && page.route.id !== '/' ? ` · ${page.route.id}` : ''}</title>
</svelte:head>

<header>
	<strong>Lab app</strong>
	<nav>
		{#each links as [href, label]}
			<a {href} aria-current={page.url.pathname === href ? 'page' : undefined}>{label}</a>
		{/each}
	</nav>
</header>

<main>
	{@render children()}
</main>

<style>
	:global(body) {
		font-family: system-ui, sans-serif;
		margin: 0;
		color: #1d1d1f;
		background: #fafafa;
	}
	header {
		display: flex;
		gap: 1.5rem;
		align-items: center;
		flex-wrap: wrap;
		padding: 0.75rem 1.25rem;
		background: #fff;
		border-bottom: 1px solid #ddd;
		position: sticky;
		top: 0;
		z-index: 10;
	}
	nav {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	nav a[aria-current='page'] {
		font-weight: 600;
		text-decoration: none;
	}
	main {
		padding: 1.25rem;
		max-width: 60rem;
	}
	:global(button) {
		font: inherit;
		padding: 0.4rem 0.8rem;
		cursor: pointer;
	}
	:global(.row) {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-block: 0.6rem;
	}
	:global(.muted) {
		color: #777;
	}
	:global(.card) {
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 6px;
		padding: 1rem;
		margin-block: 1rem;
	}
</style>
