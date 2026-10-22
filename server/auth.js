import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { pool } from './db.js'
import { asyncRoute, HttpError } from './http.js'

export function setSessionCookie(response, userId, sessionVersion = 0) {
  const token = jwt.sign({ sub: userId, ver: sessionVersion }, config.jwtSecret, { expiresIn: '12h', issuer: 'ruralattend-api', audience: 'ruralattend-web' })
  response.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.production,
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  })
}

export function clearSessionCookie(response) {
  response.clearCookie(config.cookieName, { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' })
}

export const requireAuth = asyncRoute(async (request, _response, next) => {
  const token = request.cookies?.[config.cookieName]
  if (!token) throw new HttpError(401, 'Sign in to continue.', 'authentication_required')

  let claims
  try {
    claims = jwt.verify(token, config.jwtSecret, { issuer: 'ruralattend-api', audience: 'ruralattend-web' })
  } catch {
    throw new HttpError(401, 'Your session has expired. Sign in again.', 'session_expired')
  }

  const result = await pool.query(
    `SELECT u.id, u.email, u.display_name, u.role, u.school_id, u.district_scope, u.session_version,
            u.preferred_language, u.active, s.name AS school_name, s.district AS school_district
     FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = $1`,
    [claims.sub],
  )
  const user = result.rows[0]
  if (!user?.active) throw new HttpError(401, 'This account is unavailable.', 'account_inactive')
  if (claims.ver !== user.session_version) throw new HttpError(401, 'Your session has expired. Sign in again.', 'session_revoked')

  if (user.role === 'parent') {
    const parent = await pool.query('SELECT id FROM parents WHERE user_id = $1', [user.id])
    if (!parent.rows[0]) throw new HttpError(403, 'Parent relationship is not configured.', 'parent_profile_missing')
    user.parent_id = parent.rows[0].id
  }
  request.user = user
  next()
})

export const requireRoles = (...roles) => (request, _response, next) => {
  if (!request.user || !roles.includes(request.user.role)) return next(new HttpError(403, 'You do not have permission to perform this action.', 'insufficient_role'))
  next()
}

export function getAuthorizedSchoolId(user, requestedSchoolId) {
  if (user.role === 'department') {
    if (!user.district_scope) throw new HttpError(403, 'No district scope is configured for this account.', 'scope_missing')
    if (!requestedSchoolId) return null
    return requestedSchoolId
  }
  if (!user.school_id) throw new HttpError(403, 'This account is not assigned to a school.', 'school_scope_missing')
  if (requestedSchoolId && requestedSchoolId !== user.school_id) throw new HttpError(403, 'You cannot access another school.', 'school_scope_denied')
  return user.school_id
}
