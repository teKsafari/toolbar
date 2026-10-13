import { fail } from '@sveltejs/kit';

export const actions = {
	default: async ({ request }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '');
		const name = String(data.get('name') ?? '');
		if (!email.includes('@')) return fail(400, { name, email, error: 'Email is not valid' });
		return { success: true, name };
	}
};
