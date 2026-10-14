import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint } from '#lib/server/auth/http.ts';
import { resetInviteLink } from '#lib/server/auth/invites.ts';

export const POST = endpoint(ROUTES['invites.resetLink'], ({ params, user }) => resetInviteLink(db, params.workspaceId, user.id));
