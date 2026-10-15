// GET /api/v1/skill: the Agent Skill (SKILL.md) for the feedback folder, with this server as the
// default TOOLBAR_SERVER. The repo keeps the same file in skills/open-toolbar-feedback/SKILL.md.
import { handoffSkill, SKILL_NAME } from '@toolbar/shared/areas/handoff';
import { env } from '#lib/server/env.ts';

export const GET = () =>
  new Response(handoffSkill(env.publicUrl), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `inline; filename="SKILL.md"`,
      'x-skill-name': SKILL_NAME,
      'cache-control': 'public, max-age=300',
    },
  });
