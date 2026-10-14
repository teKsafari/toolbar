import { version } from '$app/env';
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint } from '#lib/server/auth/http.ts';
import { extBootstrap } from '#lib/server/auth/bootstrap.ts';

export const GET = endpoint(ROUTES['ext.bootstrap'], ({ user, query }) =>
  extBootstrap(db, { id: user.id, name: user.name, email: user.email, image: user.image ?? null }, { workspaceId: query.workspaceId, serverVersion: version }),
);
