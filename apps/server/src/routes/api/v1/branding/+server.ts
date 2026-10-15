// GET /api/v1/branding (public, D-112): the instance name, logo, icons and accent.
import { json } from '@sveltejs/kit';
import { brandingDto } from '#lib/server/branding/index.ts';

export const GET = ({ locals }) => json(brandingDto(locals.brand), { headers: { 'Cache-Control': 'public, max-age=60' } });
