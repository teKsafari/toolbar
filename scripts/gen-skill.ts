// Writes skills/open-toolbar-feedback/SKILL.md from handoffSkill() (packages/shared/src/areas/handoff.ts).
// The server hands out the same text at /api/v1/skill with its own URL as the default server.
// Run: node scripts/gen-skill.ts
import { writeFileSync } from 'node:fs';
import { handoffSkill, SKILL_NAME } from '../packages/shared/src/areas/handoff.ts';

const out = new URL(`../skills/${SKILL_NAME}/SKILL.md`, import.meta.url);
writeFileSync(out, handoffSkill());
console.log(`wrote ${out.pathname}`);
