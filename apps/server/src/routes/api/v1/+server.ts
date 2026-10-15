import { json } from '@sveltejs/kit';
import { version } from '$app/env';
import { PRODUCT_NAME } from '@toolbar/shared';
import { ROUTE_LIST, routeListed, type RouteDef } from '@toolbar/shared/api';
import { featureFlags } from '#lib/server/env.ts';

/** API index: the contract's route table (packages/shared/src/api/routes.ts). Area agents fill in the handlers. */
// Routes of paused features (docs/scope.md) are listed only while their flag is on.
export const GET = ({ locals }) => {
  const flags = featureFlags();
  const endpoints = (ROUTE_LIST as readonly RouteDef[]).filter((r) => routeListed(r, flags)).map((r) => `${r.method.padEnd(6)} ${r.path}`);
  return json({ name: locals.brand.name, product: PRODUCT_NAME, version, endpoints });
};
