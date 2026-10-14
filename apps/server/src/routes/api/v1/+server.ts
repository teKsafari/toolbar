import { json } from '@sveltejs/kit';
import { version } from '$app/env';
import { PRODUCT_NAME } from '@toolbar/shared';
import { describeRoutes } from '@toolbar/shared/api';

/** API index: the contract's route table (packages/shared/src/api/routes.ts). Area agents fill in the handlers. */
export const GET = () => json({ name: PRODUCT_NAME, version, endpoints: describeRoutes() });
