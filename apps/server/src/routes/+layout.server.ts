// Every page gets the instance brand (D-112): name for titles, logo for the header mark.
import { pageBrand } from '#lib/server/branding/index.ts';

export const load = ({ locals }) => ({ brand: pageBrand(locals.brand) });
