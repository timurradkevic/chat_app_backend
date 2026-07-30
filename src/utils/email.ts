import nodemailer from 'nodemailer';

const EMAIL = process.env.EMAIL;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT);

if (!EMAIL || !EMAIL_PASSWORD || !SMTP_HOST || !SMTP_PORT) {
  throw new Error('EMAIL, EMAIL_PASSWORD, SMTP_HOST and SMTP_PORT must be set');
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: {
    user: EMAIL,
    pass: EMAIL_PASSWORD,
  },
});

export const mailer = {
  send(email: string, subject: string, html: string) {
    return transporter.sendMail({
      from: `"Auth API" <${EMAIL}>`,
      to: email,
      subject,
      html,
    });
  },

  sendActivationEmail(email: string, token: string) {
    const href = `${process.env.CLIENT_HOST}/activation/${token}`;
    const html = `
      <h1>Activate</h1>
      <a href="${href}">${href}</a>
    `;

    return mailer.send(email, 'Activate', html);
  },

  sendResetPasswordEmail(email: string, token: string) {
    const href = `${process.env.CLIENT_HOST}/reset-password/${token}`;
    const html = `
      <h1>Reset your password</h1>
      <p>If you requested a password reset, follow the link below. This link expires in 30 minutes.</p>
      <a href="${href}">${href}</a>
      <p>If you did not request this, you can safely ignore this email.</p>
    `;

    return mailer.send(email, 'Reset your password', html);
  },
};
