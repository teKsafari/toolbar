// Projects (Part 2 "Zero integration" and "Privacy", D-123 to D-127): the origins the
// extension may run on in a workspace and the masking preset it applies there. Workspace admins
// manage them; every member reads them, and the extension gets them in its bootstrap.
import { z } from 'zod';
import { LIMITS_PROJECT, normalizeAllowlistEntry, normalizeOrigin, PROJECT_PRESETS, TRACE_OPEN_MS } from '../projects.ts';
import { api, defineRoute, idSchema, isoSchema, okSchema } from './common.ts';

export const projectPresetSchema = z.enum(PROJECT_PRESETS);

/** Origins as typed; each is normalized, and one that cannot be is a 422 with its index. */
export const originListSchema = z
  .array(z.string().max(300))
  .max(LIMITS_PROJECT.origins)
  .transform((list, ctx) => {
    const out: string[] = [];
    list.forEach((raw, i) => {
      const o = normalizeOrigin(raw);
      if (!o) ctx.addIssue({ code: 'custom', path: [i], message: `Not a web origin: ${raw.slice(0, 80)}` });
      else if (!out.includes(o)) out.push(o);
    });
    return out;
  });

export const allowlistSchema = z
  .array(z.string().max(500))
  .max(LIMITS_PROJECT.allowlist)
  .transform((list, ctx) => {
    const out: string[] = [];
    list.forEach((raw, i) => {
      const e = normalizeAllowlistEntry(raw);
      if (!e) ctx.addIssue({ code: 'custom', path: [i], message: `Use an absolute http(s) URL prefix: ${raw.slice(0, 80)}` });
      else if (!out.includes(e)) out.push(e);
    });
    return out;
  });

/** Span window for open requests in ms (D-166), whole seconds from the settings page. */
export const traceOpenMsSchema = z
  .number()
  .int()
  .min(TRACE_OPEN_MS.min, `At least ${TRACE_OPEN_MS.min / 1000} s`)
  .max(TRACE_OPEN_MS.max, `At most ${TRACE_OPEN_MS.max / 1000} s`);

const nameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'Name the project').max(LIMITS_PROJECT.name));

export const projectSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  name: z.string(),
  origins: z.array(z.string()),
  maskingPreset: projectPresetSchema,
  bodyAllowlist: z.array(z.string()),
  /** traces: an action's span closes this long after it started while requests are still open */
  traceOpenMs: z.number().int(),
  createdAt: isoSchema,
  updatedAt: isoSchema,
});
export type Project = z.infer<typeof projectSchema>;

/** What the extension keeps of each project (bootstrap). */
export const projectScopeSchema = projectSchema.pick({ id: true, workspaceId: true, name: true, origins: true, maskingPreset: true, bodyAllowlist: true, traceOpenMs: true }).partial({ traceOpenMs: true });

const workspaceParams = z.object({ workspaceId: idSchema });

export const listProjects = defineRoute({
  name: 'projects.list',
  method: 'GET',
  path: api('/workspaces/:workspaceId/projects'),
  auth: 'member',
  role: 'viewer',
  scope: 'read',
  params: workspaceParams,
  response: z.object({ items: z.array(projectSchema) }),
  area: 'dashboard',
  tasks: ['P2-zero-integration'],
  summary: 'Projects of a workspace: origins and masking preset.',
});

export const createProjectBodySchema = z.object({
  name: nameSchema,
  origins: originListSchema.pipe(z.array(z.string()).min(1, 'Add at least one origin')),
  /** left out: the workspace's default, else the instance's (D-187) */
  maskingPreset: projectPresetSchema.optional(),
  bodyAllowlist: allowlistSchema.default([]),
  traceOpenMs: traceOpenMsSchema.optional(),
});

export const createProject = defineRoute({
  name: 'projects.create',
  method: 'POST',
  path: api('/workspaces/:workspaceId/projects'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: workspaceParams,
  body: createProjectBodySchema,
  response: projectSchema,
  status: 201,
  area: 'dashboard',
  tasks: ['P2-zero-integration'],
  summary: 'Add a project with its origins and masking preset.',
});

export const updateProject = defineRoute({
  name: 'projects.update',
  method: 'PATCH',
  path: api('/projects/:id'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: z.object({ id: idSchema }),
  body: z
    .object({
      name: nameSchema,
      origins: originListSchema.pipe(z.array(z.string()).min(1, 'Keep at least one origin')),
      maskingPreset: projectPresetSchema,
      bodyAllowlist: allowlistSchema,
      traceOpenMs: traceOpenMsSchema,
    })
    .partial(),
  response: projectSchema,
  area: 'dashboard',
  tasks: ['P2-zero-integration'],
  summary: 'Rename a project, change its origins, preset, body allowlist or trace span window.',
});

export const deleteProject = defineRoute({
  name: 'projects.delete',
  method: 'DELETE',
  path: api('/projects/:id'),
  auth: 'member',
  role: 'admin',
  scope: 'write',
  params: z.object({ id: idSchema }),
  response: okSchema,
  area: 'dashboard',
  tasks: ['P2-zero-integration'],
  summary: 'Remove a project. Its captures stay; the extension stops running on its origins.',
});

export const projectRoutes = [listProjects, createProject, updateProject, deleteProject] as const;
