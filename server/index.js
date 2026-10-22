import { createApp } from './app.js'
import { config } from './config.js'
import { closeDatabase, verifyDatabaseConnection } from './db.js'

const app = createApp()
const server = app.listen(config.port, '127.0.0.1', () => {
  console.info(`RuralAttend API listening on http://127.0.0.1:${config.port}`)
  verifyDatabaseConnection().then(
    () => console.info('PostgreSQL connection is ready.'),
    (error) => console.error(`PostgreSQL is unavailable: ${error.message}`),
  )
})

async function shutdown(signal) {
  console.info(`Received ${signal}; shutting down.`)
  server.close(async () => {
    await closeDatabase()
    process.exit(0)
  })
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
