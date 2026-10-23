import nodemailer from 'nodemailer';

/**
 * Sends the reminder emails through any SMTP server (Microsoft 365, Gmail, an internal relay...). Nothing is sent unless
 * SMTP_HOST and MAIL_FROM are set in backend/.env; the credentials never leave the server and are never sent to the browser.
 */
export const mailConfigured = (): boolean => !!process.env.SMTP_HOST && !!(process.env.MAIL_FROM ?? process.env.SMTP_USER);

export const mailFrom = (): string => process.env.MAIL_FROM ?? process.env.SMTP_USER ?? '';

export async function sendMail(to: string, mail: { subject: string; text: string; html: string }): Promise<void> {
  if (!mailConfigured()) throw new Error('Email is not set up on the server (SMTP_HOST / MAIL_FROM in backend/.env).');
  const port = Number(process.env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  await transport.sendMail({ from: mailFrom(), to, subject: mail.subject, text: mail.text, html: mail.html });
}
