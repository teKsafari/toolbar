const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function load() {
	await sleep(800);
	return {
		quick: 'first part rendered after 0.8 s',
		// Not awaited: SvelteKit streams this into the page when it resolves.
		late: sleep(3000).then(() => ({ rows: Array.from({ length: 5 }, (_, i) => `late row ${i + 1}`) }))
	};
}
