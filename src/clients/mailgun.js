const formData = require("form-data");
const Mailgun = require("mailgun.js");

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: "api",
  key: process.env.MAILGUN_API_KEY
});

async function sendContractEmail({ to, dotnumber, link }) {
  const domain = process.env.MAILGUN_DOMAIN;

  return mg.messages.create(domain, {
    from: process.env.MAILGUN_FROM,
    to,
    subject: `Carrier Agreement – Action Required (DOT ${dotnumber})`,
    text: [
      `Please review and accept the carrier agreement:`,
      link,
      ``,
      `This link expires in 72 hours.`,
      ``,
      `Carrier Shark`
    ].join("\n")
  });
}

async function sendPasswordResetEmail({ to, link }) {
  const domain = process.env.MAILGUN_DOMAIN;

  return mg.messages.create(domain, {
    from: process.env.MAILGUN_FROM,
    to,
    subject: "Reset your Carrier Shark password",
    text: [
      "We received a request to reset your password.",
      "",
      "Reset link:",
      link,
      "",
      "This link expires in 60 minutes.",
      "",
      "If you didn’t request this, you can ignore this email.",
      "",
      "Carrier Shark",
    ].join("\n"),
  });
}

async function sendSupportTicketEmail({ to, ticketId, contactEmail, contactPhone, subject, message, userEmail }) {
  const domain = process.env.MAILGUN_DOMAIN;

  return mg.messages.create(domain, {
    from: process.env.MAILGUN_FROM,
    to,
    subject: `Carrier Shark Support Ticket #${ticketId}: ${subject}`,
    text: [
      `Ticket ID: #${ticketId}`,
      userEmail ? `Account Email: ${userEmail}` : null,
      `Contact Email: ${contactEmail}`,
      contactPhone ? `Contact Phone: ${contactPhone}` : null,
      ``,
      `Subject: ${subject}`,
      ``,
      `Message:`,
      message,
      ``,
      `Carrier Shark`,
    ].filter(Boolean).join("\n"),
  });
}


module.exports = { sendContractEmail, sendPasswordResetEmail, sendSupportTicketEmail };



