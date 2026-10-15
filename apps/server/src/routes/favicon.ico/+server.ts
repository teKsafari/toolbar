// Old browsers and crawlers ask for /favicon.ico; send them the brand's 32 px icon (D-112).
import { redirect } from '@sveltejs/kit';

export const GET = ({ locals }) => redirect(302, `/brand/icon-32.png?v=${locals.brand.version}`);
