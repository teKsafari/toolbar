// The route table: every endpoint the extension, viewer, dashboard, CLI and MCP call.
// Servers look handlers up by `name`; clients build URLs with buildPath(route.path, params).
// New routes go in the area's own file (src/api/<area>-*.ts) and are listed here at merge.
import type { RouteDef } from './common.ts';
import { captureRoutes } from './captures.ts';
import { commentRoutes } from './comments.ts';
import { sharingRoutes } from './sharing.ts';
import { folderRoutes } from './folders.ts';
import { workspaceRoutes } from './workspaces.ts';
import { integrationRoutes } from './integrations.ts';
import { accountRoutes } from './account.ts';
import { brandingRoutes } from './branding.ts';
import { instanceSettingsRoutes } from './instance-settings.ts';
import { projectRoutes } from './projects.ts';
import { embedRoutes } from './embed.ts';
import { serverCoreAreaRoutes } from './areas/server-core.ts';
import { authAreaRoutes } from './areas/auth.ts';
import { captureAreaRoutes } from './areas/capture.ts';
import { extUiAreaRoutes } from './areas/ext-ui.ts';
import { editorAreaRoutes } from './areas/editor.ts';
import { viewerAreaRoutes } from './areas/viewer.ts';
import { dashboardAreaRoutes } from './areas/dashboard.ts';
import { agentAreaRoutes } from './areas/agent.ts';
import { traceAreaRoutes } from './areas/trace.ts';
import { reviewerAreaRoutes } from './areas/reviewer.ts';
import { handoffAreaRoutes } from './areas/handoff.ts';

export const ROUTE_LIST = [
  ...captureRoutes,
  ...commentRoutes,
  ...sharingRoutes,
  ...folderRoutes,
  ...workspaceRoutes,
  ...integrationRoutes,
  ...accountRoutes,
  ...brandingRoutes,
  ...instanceSettingsRoutes,
  ...projectRoutes,
  ...embedRoutes,
  // per-area additions (src/api/areas/<area>.ts)
  ...serverCoreAreaRoutes,
  ...authAreaRoutes,
  ...captureAreaRoutes,
  ...extUiAreaRoutes,
  ...editorAreaRoutes,
  ...viewerAreaRoutes,
  ...dashboardAreaRoutes,
  ...agentAreaRoutes,
  ...traceAreaRoutes,
  ...reviewerAreaRoutes,
  ...handoffAreaRoutes,
] as const;

type AnyRoute = (typeof ROUTE_LIST)[number];
export type RouteName = AnyRoute['name'];
export type RouteByName<N extends RouteName> = Extract<AnyRoute, { name: N }>;

/** Routes by name, e.g. ROUTES['captures.finalize']. */
export const ROUTES = Object.fromEntries(ROUTE_LIST.map((r) => [r.name, r])) as { [N in RouteName]: RouteByName<N> };

export function routesOfArea(area: RouteDef['area']): RouteDef[] {
  return (ROUTE_LIST as readonly RouteDef[]).filter((r) => r.area === area);
}

/** One line per route, as the API index (GET /api/v1) prints them. */
export function describeRoutes(): string[] {
  return (ROUTE_LIST as readonly RouteDef[]).map((r) => `${r.method.padEnd(6)} ${r.path}`);
}
