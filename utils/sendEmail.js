const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,       // e.g., smtp.hostinger.com
  port: process.env.SMTP_PORT,       // 465 or 587
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,     // foodstuffs@zandmarket.co.uk
    pass: process.env.SMTP_PASS,     // your email password
  },
  tls: {
    rejectUnauthorized: false, // <<< allow self-signed certificates
  },
});

const sendEmail = async ({ to, subject, html }) => {
  const mailOptions = {
    from: `"ZandMarket" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
