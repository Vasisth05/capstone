import { config } from '../config.js'

export async function deliverEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM
  if (!apiKey || !from) {
    if (!config.production) {
      console.info(`Development email to ${to}: ${subject}\n${text}`)
      return { delivered: false, developmentLogged: true }
    }
    return { delivered: false, reason: 'Email delivery is not configured.' }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
  })
  if (!response.ok) throw new Error(`Email provider returned status ${response.status}.`)
  return { delivered: true }
}
