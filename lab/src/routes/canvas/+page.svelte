<script lang="ts">
	let canvas: HTMLCanvasElement;
	let n = $state(0);

	function draw() {
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#10243e';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = '#e6edf3';
		ctx.font = '16px monospace';
		const lines = ['$ python main.py', `Run ${n}: Hello from the canvas`, n % 2 ? 'Traceback: ZeroDivisionError' : 'exit 0'];
		lines.forEach((l, i) => ctx.fillText(l, 12, 28 + i * 24));
	}

	$effect(() => {
		draw();
	});
</script>

<h1>Canvas</h1>
<p class="muted">The text below is drawn on a canvas, not in the DOM.</p>
<canvas bind:this={canvas} width="520" height="110"></canvas>
<div class="row">
	<button
		data-testid="redraw"
		onclick={() => {
			n++;
			draw();
		}}>Run again (redraws the canvas only)</button
	>
</div>
