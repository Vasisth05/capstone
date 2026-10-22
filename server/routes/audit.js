import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { asyncRoute, HttpError, validate } from '../http.js'

const router = Router()
const filtersSchema = z.object({
  q: z.string().max(100).optional(),
  action: z.string().max(100).optional(),
  resourceType: z.string().max(80).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict()

router.get('/', requireAuth, asyncRoute(async (request, response) => {
  const filters = validate(filtersSchema, request.query)
  const user = request.user
  const params = []
  const where = []
  if (user.role === 'department') {
    if (!user.district_scope) throw new HttpError(403, 'No district scope is configured.', 'scope_missing')
    params.push(user.district_scope)
    where.push(`s.district = $${params.length}`)
  } else if (user.role === 'principal' || user.role === 'school_admin') {
    if (!user.school_id) throw new HttpError(403, 'No school is assigned to this account.', 'school_scope_missing')
    params.push(user.school_id)
    where.push(`a.school_id = $${params.length}`)
  } else if (user.role === 'teacher') {
    params.push(user.id)
    where.push(`a.actor_id = $${params.length}`)
  } else throw new HttpError(403, 'You cannot access the audit log.', 'insufficient_role')

  if (filters.q) { params.push(`%${filters.q}%`); where.push(`(a.action ILIKE $${params.length} OR a.resource_type ILIKE $${params.length} OR COALESCE(u.display_name, '') ILIKE $${params.length})`) }
  if (filters.action) { params.push(filters.action); where.push(`a.action = $${params.length}`) }
  if (filters.resourceType) { params.push(filters.resourceType); where.push(`a.resource_type = $${params.length}`) }
  if (filters.from) { params.push(filters.from); where.push(`a.created_at >= $${params.length}::date`) }
  if (filters.to) { params.push(filters.to); where.push(`a.created_at < ($${params.length}::date + INTERVAL '1 day')`) }
  const count = await pool.query(`SELECT count(*)::int AS total FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN schools s ON s.id = a.school_id WHERE ${where.join(' AND ')}`, params)
  const limit = params.push(filters.pageSize)
  const offset = params.push((filters.page - 1) * filters.pageSize)
  const result = await pool.query(
    `SELECT a.id, a.actor_id, u.display_name AS actor_name, a.school_id, a.action, a.resource_type,
       a.resource_id, a.metadata, a.created_at
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN schools s ON s.id = a.school_id
     WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT $${limit} OFFSET $${offset}`,
    params,
  )
  response.json({ items: result.rows, total: count.rows[0].total, page: filters.page, pageSize: filters.pageSize })
}))

export default router
