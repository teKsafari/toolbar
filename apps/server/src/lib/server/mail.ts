import nodemailer from 'nodemailer';
import { env } from './env.ts';
import { currentBrand } from './branding/index.ts';

/** MAIL_FROM, else the instance name at noreply@ the public host. */
export function mailFrom(): string {
  if (env.mailFrom) return env.mailFrom;
  const name = currentBrand().name.replace(/["\\]/g, '');
  return `"${name}" <noreply@${new URL(env.publicUrl).hostname}>`;
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

let warned = false;

/**
 * SMTP_URL, e.g. smtp://mailpit:1025 with the override docker-compose.mail.yml. Mail is paused by owner
 * scope unless FEATURE_EMAIL is on (D-079), and without SMTP_URL nothing leaves the server.
 */
export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (!env.features.email) return;
  if (!env.smtpUrl) {
    if (!warned) console.warn('[mail] FEATURE_EMAIL is on but SMTP_URL is empty: no mail is sent');
    warned = true;
    return;
  }
  transport ??= nodemailer.createTransport(env.smtpUrl);
  await transport.sendMail({ from: mailFrom(), to, subject, text, html });
}
