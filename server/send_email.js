const axios = require('axios');

module.exports = async function sendEmail(name, email, downloadUrl) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) throw new Error('Missing RESEND_API_KEY');

  const body = {
    from: 'Array Escape <no-reply@yourdomain.com>',
    to: [email],
    subject: 'Your Array Escape Roadmap Is Ready 🚀',
    html: `
      <p>Hi ${name},</p>
      <p>Thank you for purchasing Array Escape™.</p>
      <p>Your payment has been confirmed.</p>
      <p>Download your roadmap below:</p>
      <p><a href="${downloadUrl}">Download Roadmap</a></p>
      <p>Happy Learning 🚀<br/>Array Escape Team</p>
    `
  };

  await axios.post('https://api.resend.com/emails', body, {
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
};
