const formData = require("form-data");
const Mailgun = require("mailgun.js");

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: "api",
  key: process.env.MAILGUN_API_KEY
});

async function sendContractEmail({
  to,
  broker_name,
  carrier_name,
  dotnumber,
  agreement_type,
  link
}) {
  const domain = process.env.MAILGUN_DOMAIN;

  return mg.messages.create(domain, {
    from: process.env.MAILGUN_FROM,
    to,
    template: "carrier agreement",

    // Variables for the HTML template + subject
    "h:X-Mailgun-Variables": JSON.stringify({
      broker_name,
      carrier_name,
      dotnumber,
      agreement_type,
      link
    }),

    // Plain-text fallback (for basic email clients)
    text: [
      `${broker_name} sent you a carrier agreement to review.`,
      ``,
      `Carrier: ${carrier_name || "N/A"}`,
      `DOT: ${dotnumber}`,
      `Agreement: ${agreement_type}`,
      ``,
      `Review and accept here:`,
      link,
      ``,
      `This link expires in 72 hours.`,
      ``,
      `If you did not expect this, you can ignore this email.`,
      ``,
      `— Carrier Shark`
    ].join("\n")
  });
}


async function sendPasswordResetEmail({ to, link }) {
  const domain = process.env.MAILGUN_DOMAIN;

  return mg.messages.create(domain, {
    from: process.env.MAILGUN_FROM,
    to,
    template: "password reset",
    "h:X-Mailgun-Variables": JSON.stringify({ link }),
    text: [
      "We received a request to reset your Carrier Shark password.",
      "",
      "Reset link:",
      link,
      "",
      "This link expires in 60 minutes.",
      "",
      "If you didn’t request this, you can ignore this email."
    ].join("\n")
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


async function sendContractOtpEmail({ to, otp }) {
  const domain = process.env.MAILGUN_DOMAIN;

  return mg.messages.create(domain, {
    from: process.env.MAILGUN_FROM,
    to,
    subject: "Carrier Shark security code",

    // Plain text fallback (simple + defensible wording)
    text: [
      `Your Carrier Shark security code is: ${otp}`,
      ``,
      `This code expires in 5 minutes.`,
      ``,
      `If you did not request this code, you can ignore this email.`,
      ``,
      `— Carrier Shark`
    ].join("\n")
  });
}


module.exports = {
  sendContractEmail,
  sendContractOtpEmail,
  sendPasswordResetEmail,
  sendSupportTicketEmail
};
