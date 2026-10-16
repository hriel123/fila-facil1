import nodemailer from 'nodemailer';

// E-mail por SMTP (por exemplo, Gmail com senha de app). Sem SMTP_HOST,
// SMTP_USER e SMTP_PASS a recuperação de senha fica desligada.
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
const port = Number(SMTP_PORT) || 465;

export const mailConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

const transporter = mailConfigured
  ? nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } })
  : null;

export function sendMail({ to, subject, text, html }) {
  return transporter.sendMail({ from: MAIL_FROM || `FilaFácil <${SMTP_USER}>`, to, subject, text, html });
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
