import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint } from '#lib/server/auth/http.ts';
import { getInviteLink } from '#lib/server/auth/invites.ts';

export const GET = endpoint(ROUTES['invites.getLink'], ({ params, user }) => getInviteLink(db, params.workspaceId, user.id));
