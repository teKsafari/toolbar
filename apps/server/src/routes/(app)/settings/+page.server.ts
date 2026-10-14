import { redirect } from '@sveltejs/kit';
// J-171: workspace menu, settings lands on the workspace's general page.
export const load = () => redirect(307, '/settings/workspace');
