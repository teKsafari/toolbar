// GitHub and GitLab issues through a personal access token, Slack through an incoming webhook
// URL (docs/tasks.md proposed decisions). Each provider tests its credentials on connect, lists
// picker options (J-140) and files an issue or posts a message (J-137, J-138).

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number | null = null,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 10_000;

async function call(url: string, init: RequestInit & { token?: string; kind: 'github' | 'gitlab' | 'slack' }): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.kind === 'github') {
    headers.set('accept', 'application/vnd.github+json');
    headers.set('x-github-api-version', '2022-11-28');
    if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  } else if (init.kind === 'gitlab' && init.token) headers.set('private-token', init.token);
  headers.set('user-agent', 'toolbar-server');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new ProviderError(`Could not reach ${new URL(url).host}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const t = await res.text();
      const j = JSON.parse(t) as { message?: string; error?: string };
      detail = j.message ?? j.error ?? t.slice(0, 200);
    } catch {
      /* no body */
    }
    throw new ProviderError(`${new URL(url).host} answered ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }
  return res;
}

export interface Options {
  repos: { id: string; fullName: string }[];
  labels: { name: string; color: string | null }[];
  assignees: { login: string; name: string | null; avatarUrl: string | null }[];
  milestones: { id: string; title: string }[];
}

export interface Filed {
  url: string;
  key: string;
  title: string;
}

// ---------- GitHub ----------

export const github = {
  async whoami(baseUrl: string, token: string): Promise<string> {
    const r = await call(`${baseUrl}/user`, { kind: 'github', token });
    return ((await r.json()) as { login: string }).login;
  },
  async options(baseUrl: string, token: string, repo?: string, q?: string): Promise<Options> {
    const repos = (await (await call(`${baseUrl}/user/repos?per_page=100&sort=pushed`, { kind: 'github', token })).json()) as {
      id: number;
      full_name: string;
    }[];
    const out: Options = {
      repos: repos.filter((r) => !q || r.full_name.toLowerCase().includes(q.toLowerCase())).map((r) => ({ id: String(r.id), fullName: r.full_name })),
      labels: [],
      assignees: [],
      milestones: [],
    };
    if (repo) {
      const [labels, assignees, milestones] = await Promise.all([
        call(`${baseUrl}/repos/${repo}/labels?per_page=100`, { kind: 'github', token }).then((r) => r.json() as Promise<{ name: string; color: string }[]>),
        call(`${baseUrl}/repos/${repo}/assignees?per_page=100`, { kind: 'github', token }).then(
          (r) => r.json() as Promise<{ login: string; avatar_url: string }[]>,
        ),
        call(`${baseUrl}/repos/${repo}/milestones?state=open&per_page=100`, { kind: 'github', token }).then(
          (r) => r.json() as Promise<{ number: number; title: string }[]>,
        ),
      ]);
      out.labels = labels.map((l) => ({ name: l.name, color: l.color ? `#${l.color}` : null }));
      out.assignees = assignees.map((a) => ({ login: a.login, name: null, avatarUrl: a.avatar_url ?? null }));
      out.milestones = milestones.map((m) => ({ id: String(m.number), title: m.title }));
    }
    return out;
  },
  async file(baseUrl: string, token: string, f: { repo: string; title: string; body: string; labels: string[]; assignees: string[]; milestone?: string }): Promise<Filed> {
    const body: Record<string, unknown> = { title: f.title, body: f.body };
    if (f.labels.length) body.labels = f.labels;
    if (f.assignees.length) body.assignees = f.assignees;
    if (f.milestone) body.milestone = Number(f.milestone) || f.milestone;
    const r = await call(`${baseUrl}/repos/${f.repo}/issues`, { kind: 'github', token, method: 'POST', body: JSON.stringify(body) });
    const j = (await r.json()) as { html_url: string; number: number; title: string };
    return { url: j.html_url, key: `${f.repo}#${j.number}`, title: j.title };
  },
};

// ---------- GitLab ----------

export const gitlab = {
  async whoami(baseUrl: string, token: string): Promise<string> {
    const r = await call(`${baseUrl}/api/v4/user`, { kind: 'gitlab', token });
    return ((await r.json()) as { username: string }).username;
  },
  async options(baseUrl: string, token: string, project?: string, q?: string): Promise<Options> {
    const projects = (await (
      await call(`${baseUrl}/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at${q ? `&search=${encodeURIComponent(q)}` : ''}`, {
        kind: 'gitlab',
        token,
      })
    ).json()) as { id: number; path_with_namespace: string }[];
    const out: Options = { repos: projects.map((p) => ({ id: String(p.id), fullName: p.path_with_namespace })), labels: [], assignees: [], milestones: [] };
    if (project) {
      const p = encodeURIComponent(project);
      const [labels, members, milestones] = await Promise.all([
        call(`${baseUrl}/api/v4/projects/${p}/labels?per_page=100`, { kind: 'gitlab', token }).then((r) => r.json() as Promise<{ name: string; color: string }[]>),
        call(`${baseUrl}/api/v4/projects/${p}/members/all?per_page=100`, { kind: 'gitlab', token }).then(
          (r) => r.json() as Promise<{ username: string; name: string; avatar_url: string | null }[]>,
        ),
        call(`${baseUrl}/api/v4/projects/${p}/milestones?state=active&per_page=100`, { kind: 'gitlab', token }).then(
          (r) => r.json() as Promise<{ id: number; title: string }[]>,
        ),
      ]);
      out.labels = labels.map((l) => ({ name: l.name, color: l.color ?? null }));
      out.assignees = members.map((m) => ({ login: m.username, name: m.name, avatarUrl: m.avatar_url }));
      out.milestones = milestones.map((m) => ({ id: String(m.id), title: m.title }));
    }
    return out;
  },
  async file(baseUrl: string, token: string, f: { repo: string; title: string; body: string; labels: string[]; assignees: string[]; milestone?: string }): Promise<Filed> {
    const p = encodeURIComponent(f.repo);
    const body: Record<string, unknown> = { title: f.title, description: f.body };
    if (f.labels.length) body.labels = f.labels.join(',');
    if (f.milestone) body.milestone_id = Number(f.milestone);
    if (f.assignees.length) {
      const ids: number[] = [];
      for (const login of f.assignees) {
        const us = (await (await call(`${baseUrl}/api/v4/users?username=${encodeURIComponent(login)}`, { kind: 'gitlab', token })).json()) as { id: number }[];
        if (us[0]) ids.push(us[0].id);
      }
      if (ids.length) body.assignee_ids = ids;
    }
    const r = await call(`${baseUrl}/api/v4/projects/${p}/issues`, { kind: 'gitlab', token, method: 'POST', body: JSON.stringify(body) });
    const j = (await r.json()) as { web_url: string; iid: number; title: string };
    return { url: j.web_url, key: `${f.repo}#${j.iid}`, title: j.title };
  },
};

// ---------- Slack incoming webhook ----------

export const slack = {
  async post(webhookUrl: string, text: string): Promise<void> {
    await call(webhookUrl, { kind: 'slack', method: 'POST', body: JSON.stringify({ text }) });
  },
  /** Slack offers no read call for incoming webhooks; a URL check stands in for the connect test. */
  check(webhookUrl: string) {
    const u = new URL(webhookUrl);
    // http only for this machine: localhost, or the host as a container sees it
    if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1|host\.docker\.internal)$/.test(u.hostname)) throw new ProviderError('Webhook URLs must use https');
  },
};
