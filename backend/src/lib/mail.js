import nodemailer from 'nodemailer';

// E-mail da recuperação de senha. No plano gratuito do Render as portas de
// SMTP são bloqueadas, então o envio padrão é pela API HTTPS do Brevo
// (BREVO_API_KEY). Sem ela, usa SMTP (SMTP_HOST, SMTP_USER e SMTP_PASS),
// que funciona em servidor pago ou localmente. Sem nenhum dos dois, a
// recuperação de senha fica desligada.
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, BREVO_API_KEY } = process.env;
const port = Number(SMTP_PORT) || 465;
const senderEmail = MAIL_FROM || SMTP_USER;
const useBrevo = Boolean(BREVO_API_KEY && senderEmail);

export const mailConfigured = useBrevo || Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

const transporter = !useBrevo && mailConfigured
  ? nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } })
  : null;

export async function sendMail({ to, subject, text, html }) {
  if (useBrevo) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: 'FilaFácil', email: senderEmail }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  await transporter.sendMail({ from: `FilaFácil <${senderEmail}>`, to, subject, text, html });
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
