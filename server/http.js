export class HttpError extends Error {
  constructor(status, message, code = 'request_error', details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const asyncRoute = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next)
}

export function validate(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new HttpError(400, 'Request validation failed.', 'validation_error', result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })))
  }
  return result.data
}

export async function writeAudit({ client, actorId, schoolId, action, resourceType, resourceId, metadata = {} }) {
  const query = client ?? (await import('./db.js')).pool
  await query.query(
    `INSERT INTO audit_logs(actor_id, school_id, action, resource_type, resource_id, metadata)
     VALUES($1, $2, $3, $4, $5, $6)`,
    [actorId ?? null, schoolId ?? null, action, resourceType, resourceId ?? null, JSON.stringify(metadata)],
  )
}

export function errorHandler(error, _request, response, _next) {
  if (response.headersSent) return
  if (error.code === '23505') return response.status(409).json({ error: 'A record with these details already exists.', code: 'conflict' })
  if (error.code === '23503') return response.status(409).json({ error: 'This record is still linked to other school data.', code: 'relationship_conflict' })
  if (error.code === '23514') return response.status(400).json({ error: 'A record failed a database validation rule.', code: 'constraint_error' })
  const status = Number.isInteger(error.status) ? error.status : 500
  if (status >= 500) console.error('API error:', error.message)
  response.status(status).json({
    error: status >= 500 && process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred.' : error.message,
    code: error.code ?? 'internal_error',
    ...(error.details ? { details: error.details } : {}),
  })
}
