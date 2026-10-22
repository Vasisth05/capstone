const cdpOrigin = process.env.CHROME_CDP_ORIGIN ?? 'http://127.0.0.1:9222'
const appOrigin = process.env.RURALATTEND_ORIGIN ?? 'http://127.0.0.1:5173'
const targets = await (await fetch(`${cdpOrigin}/json/list`)).json()
const target = targets.find((item) => item.type === 'page' && item.url === `${appOrigin}/`)
if (!target) throw new Error(`Open ${appOrigin}/ in the Chromium instance exposed at ${cdpOrigin}.`)

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 1
function command(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      socket.removeEventListener('message', listener)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    }
    socket.addEventListener('message', listener)
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result?.value
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const widths = [390, 768, 1280]
const roles = ['Teacher', 'Principal', 'School Admin', 'Education Department', 'Parent']
const pagesExpression = `(() => {
  addEventListener('error', (event) => window.__ruralAttendErrors.push(event.message))
  addEventListener('unhandledrejection', (event) => window.__ruralAttendErrors.push(String(event.reason)))
  return true
})()`

const results = []
try {
  await command('Runtime.enable')
  await evaluate('window.__ruralAttendErrors = []')
  await evaluate(pagesExpression)
  for (const width of widths) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width <= 650 })
    await pause(100)
    for (const role of roles) {
      const selectRole = `(() => { const select = document.querySelector('.role-switch select'); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(role)}); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`
      if (!await evaluate(selectRole)) throw new Error('The role selector was not found; this smoke requires the development demo.')
      await pause(120)
      const names = await evaluate("[...document.querySelectorAll('.main-nav .nav-link,.sidebar-bottom>.nav-link')].map((link) => link.innerText.trim())")
      for (const name of names) {
        const clickPage = `(() => { const link = [...document.querySelectorAll('.sidebar .nav-link')].find((item) => item.innerText.trim() === ${JSON.stringify(name)}); if (!link) return false; link.click(); return true })()`
        if (!await evaluate(clickPage)) {
          results.push({ width, role, page: name, missing: true })
          continue
        }
        await pause(80)
        const details = await evaluate(`({ heading: document.querySelector('main h1')?.innerText ?? null, viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth })`)
        results.push({ width, role, page: name, ...details })
      }
    }
  }
  const errors = await evaluate('window.__ruralAttendErrors')
  const missing = results.filter((result) => result.missing || !result.heading)
  const overflow = results.filter((result) => result.documentWidth > result.viewport + 1)
  const report = { screens: results.length, missing, horizontalOverflow: overflow, errors }
  console.log(JSON.stringify(report))
  if (missing.length || overflow.length || errors.length) process.exitCode = 1
} finally {
  await command('Emulation.clearDeviceMetricsOverride').catch(() => {})
  socket.close()
}
