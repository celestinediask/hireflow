const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendVerificationEmail(to, verifyUrl) {
  await resend.emails.send({
    from: process.env.FROM_EMAIL,
    to,
    subject: 'Verify your email address',
    html: `
      <h1>Email Verification</h1>
      <p>Click the link below to verify your email address:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
    `,
  });
}

module.exports = { sendVerificationEmail };
