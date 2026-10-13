<script lang="ts">
	import { enhance } from '$app/forms';
	let { form } = $props();
</script>

<h1>Form</h1>
<form method="POST" use:enhance class="card">
	<p><label>Name <input name="name" type="text" autocomplete="name" value={form?.name ?? ''} /></label></p>
	<p><label>Email <input name="email" type="email" autocomplete="email" value={form?.email ?? ''} /></label></p>
	<p><label>Password <input name="password" type="password" autocomplete="new-password" /></label></p>
	<p><label>Notes <textarea name="notes" rows="3"></textarea></label></p>
	<button>Create account</button>
	{#if form?.error}<p role="alert" style="color: #b00">{form.error}</p>{/if}
	{#if form?.success}<p role="status">Welcome, {form.name}.</p>{/if}
</form>
