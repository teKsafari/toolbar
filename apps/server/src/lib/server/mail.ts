import nodemailer from 'nodemailer';
import { env } from './env.ts';

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

/** SMTP_URL, e.g. smtp://mailpit:1025 in compose. Mail goes to Mailpit on a clean machine. */
export async function sendMail(to: string, subject: string, text: string, html?: string) {
  // mail is paused by owner scope unless FEATURE_EMAIL is on (D-079): nothing leaves the server
  if (!env.features.email) return;
  transport ??= nodemailer.createTransport(env.smtpUrl);
  await transport.sendMail({ from: env.mailFrom, to, subject, text, html });
}
