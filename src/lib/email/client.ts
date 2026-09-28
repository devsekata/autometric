import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  // What nodemailer's `service: 'gmail'` preset resolves to, spelled out.
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    // Google displays App Passwords in groups of four ("abcd efgh ijkl mnop").
    // Pasted as shown, the spaces are not part of the password.
    pass: process.env.SMTP_PASS?.replace(/\s+/g, ''),
  },
  // Fail a register/reset request in seconds rather than holding it open on a
  // stalled SMTP connection.
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
})

export default transporter
