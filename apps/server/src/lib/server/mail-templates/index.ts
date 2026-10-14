// Email bodies the dashboard area sends: folder invites (J-122), recording link used (J-017,
// J-126), account deletion notice (J-225). Plain text first, a small HTML twin second.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function html(lines: string[], button?: { label: string; url: string }) {
  const body = lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('');
  const btn = button
    ? `<p style="margin:16px 0"><a href="${esc(button.url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#3446cf;color:#fff;text-decoration:none;font-weight:600">${esc(button.label)}</a></p>`
    : '';
  return `<div style="font:14px/1.5 system-ui,sans-serif;color:#1d1b18;max-width:520px">${body}${btn}</div>`;
}

export interface Mail {
  subject: string;
  text: string;
  html: string;
}

export function folderInviteMail(o: { inviter: string; folder: string; url: string; product: string }): Mail {
  const lines = [`${o.inviter} shared the folder "${o.folder}" with you on ${o.product}.`, 'Open it to see the captures inside.'];
  return {
    subject: `${o.inviter} shared "${o.folder}" with you`,
    text: `${lines.join('\n\n')}\n\n${o.url}\n`,
    html: html(lines, { label: 'Open folder', url: o.url }),
  };
}

export function recordingLinkUsedMail(o: { linkName: string; captureUrl: string; note: string | null; product: string }): Mail {
  const lines = [`Someone recorded through your link "${o.linkName}".`];
  if (o.note) lines.push(`Their note: ${o.note}`);
  return {
    subject: `New recording from "${o.linkName}"`,
    text: `${lines.join('\n\n')}\n\nWatch it: ${o.captureUrl}\n\n(${o.product} recording links)`,
    html: html(lines, { label: 'Watch the recording', url: o.captureUrl }),
  };
}

export function accountDeletedMail(o: { name: string; workspaces: string[]; product: string }): Mail {
  const lines = [`Your ${o.product} account (${o.name}) was deleted.`];
  if (o.workspaces.length) lines.push(`These workspaces were erased with it: ${o.workspaces.join(', ')}.`);
  return { subject: `Your ${o.product} account was deleted`, text: lines.join('\n\n'), html: html(lines) };
}

export function firstViewMail(o: { viewer: string; title: string; captureUrl: string; product: string }): Mail {
  const lines = [`${o.viewer} opened your capture "${o.title}". This is the first view by someone other than you.`];
  return {
    subject: `${o.viewer} viewed "${o.title}"`,
    text: `${lines.join('\n\n')}\n\nOpen it: ${o.captureUrl}\n\n(${o.product} notifications: turn this email off in your account settings)`,
    html: html(lines, { label: 'Open the capture', url: o.captureUrl }),
  };
}
