import assert from 'node:assert/strict'
import { once } from 'node:events'
import test, { after } from 'node:test'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

process.env.RURALATTEND_TEST_DISABLE_LIMITERS = 'true'
const { createApp } = await import('./app.js')
const { closeDatabase, pool } = await import('./db.js')
after(closeDatabase)

async function startTestServer() {
  const app = createApp({ disableRateLimit: true })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  return { app, server, baseUrl: `http://127.0.0.1:${port}` }
}

function stopTestServer(server) {
  return new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections()
  })
}

function sessionCookie(user) {
  const token = jwt.sign({ sub: user.id, ver: user.session_version }, config.jwtSecret, { expiresIn: '12h', issuer: 'ruralattend-api', audience: 'ruralattend-web' })
  return `${config.cookieName}=${token}`
}

async function withPoolQueryMock(mock, run) {
  const originalQuery = pool.query
  pool.query = (...args) => mock(...args)
  try { await run() }
  finally { pool.query = originalQuery }
}

test('protected API routes reject unauthenticated callers before database access', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))

  for (const path of ['/api/auth/me', '/api/students', '/api/classes', '/api/attendance', '/api/reports/attendance', '/api/devices', '/api/teachers', '/api/users', '/api/schools', '/api/notifications', '/api/audit']) {
    const response = await fetch(`${baseUrl}${path}`)
    assert.equal(response.status, 401, `${path} should require a valid server session`)
    assert.equal((await response.json()).code, 'authentication_required')
  }
})

test('authenticated profile includes the real school or district workspace name', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))
  const user = {
    id: '00000000-0000-4000-8000-000000000006',
    email: 'staff@example.test',
    display_name: 'School Staff',
    role: 'school_admin',
    school_id: '00000000-0000-4000-8000-000000000007',
    school_name: 'Actual school name',
    district_scope: null,
    school_district: 'Actual district',
    session_version: 1,
    preferred_language: 'en',
    active: true,
  }

  await withPoolQueryMock(async (sql) => {
    if (sql.includes('FROM users u LEFT JOIN schools')) return { rows: [user] }
    throw new Error(`Profile route should not issue other queries: ${sql}`)
  }, async () => {
    const response = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: sessionCookie(user) } })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).user, {
      id: user.id,
      email: user.email,
      name: user.display_name,
      role: user.role,
      schoolId: user.school_id,
      schoolName: user.school_name,
      districtScope: user.district_scope,
      language: user.preferred_language,
    })
  })
})

test('teacher-class assignment create and update reject unauthenticated callers before touching PostgreSQL', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))
  const create = await fetch(`${baseUrl}/api/classes/00000000-0000-4000-8000-000000000001/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacherId: '00000000-0000-4000-8000-000000000002' }),
  })
  const update = await fetch(`${baseUrl}/api/classes/00000000-0000-4000-8000-000000000001/assignments/00000000-0000-4000-8000-000000000002/2026-10-19`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endsOn: null }),
  })
  for (const response of [create, update]) {
    assert.equal(response.status, 401)
    assert.equal((await response.json()).code, 'authentication_required')
  }
})

test('parent account status rejects unauthenticated callers before touching PostgreSQL', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))
  const response = await fetch(`${baseUrl}/api/users/00000000-0000-4000-8000-000000000001/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: false }),
  })
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, 'authentication_required')
})

test('device registration rejects unauthenticated callers before touching PostgreSQL', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))
  const response = await fetch(`${baseUrl}/api/devices/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceLabel: 'RuralAttend browser test' }) })
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, 'authentication_required')
})

test('device revocation rejects unauthenticated callers before touching PostgreSQL', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))
  const response = await fetch(`${baseUrl}/api/devices/00000000-0000-4000-8000-000000000001`, { method: 'DELETE' })
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, 'authentication_required')
})

test('QR issuance and verification require an authenticated server session', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))

  const issue = await fetch(`${baseUrl}/api/attendance/qr-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: '00000000-0000-4000-8000-000000000001' }) })
  const verify = await fetch(`${baseUrl}/api/attendance/qr/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'forged-token-value-that-is-long-enough' }) })
  assert.equal(issue.status, 401)
  assert.equal(verify.status, 401)
  assert.equal((await issue.json()).code, 'authentication_required')
  assert.equal((await verify.json()).code, 'authentication_required')
})

test('CORS rejects origins not on the configured allowlist', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))

  const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://not-allowed.example' } })
  assert.equal(response.status, 403)
  assert.equal((await response.json()).code, 'cors_origin_denied')
})

test('health endpoint reports PostgreSQL availability without exposing connection details', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))

  const response = await fetch(`${baseUrl}/api/health`)
  assert.ok([200, 503].includes(response.status))
  const body = await response.json()
  assert.ok(['ok', 'degraded'].includes(body.status))
  assert.ok(['connected', 'unavailable'].includes(body.database))
  assert.equal('connectionString' in body, false)
})

test('a parent can read linked child attendance but not another family\'s child', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))
  const parentUserId = '00000000-0000-4000-8000-000000000011'
  const parentId = '00000000-0000-4000-8000-000000000012'
  const ownStudentId = '00000000-0000-4000-8000-000000000013'
  const otherStudentId = '00000000-0000-4000-8000-000000000014'
  const schoolId = '00000000-0000-4000-8000-000000000015'
  const user = { id: parentUserId, email: 'parent@example.test', display_name: 'Parent Test', role: 'parent', school_id: schoolId, district_scope: null, session_version: 2, preferred_language: 'en', active: true, school_district: 'District A' }
  const calls = []

  await withPoolQueryMock(async (sql, params) => {
    calls.push({ sql, params })
    if (sql.includes('FROM users u LEFT JOIN schools')) return { rows: [user] }
    if (sql.includes('FROM parents WHERE user_id')) return { rows: [{ id: parentId }] }
    if (sql.includes('SELECT a.id AS session_id')) {
      assert.match(sql, /ps\.parent_id = \$1 AND s\.id = \$2 AND s\.active = true/)
      assert.match(sql, /a\.state IN \('submitted', 'approved'\)/)
      assert.equal(params[0], parentId)
      if (params[1] === otherStudentId) return { rows: [] }
      assert.deepEqual(params, [parentId, ownStudentId])
      return { rows: [{ session_id: 'session-1', attendance_date: '2026-10-19', revision: 1, state: 'submitted', status: 'present', note: null, class_name: 'Class V', section: 'A' }] }
    }
    if (sql.includes('SELECT 1 FROM parent_students ps JOIN students s')) {
      assert.deepEqual(params, [parentId, otherStudentId])
      return { rows: [] }
    }
    throw new Error(`Unexpected SQL in parent privacy test: ${sql}`)
  }, async () => {
    const visible = await fetch(`${baseUrl}/api/parents/me/children/${ownStudentId}/attendance`, { headers: { Cookie: sessionCookie(user) } })
    assert.equal(visible.status, 200)
    assert.equal((await visible.json()).items[0].status, 'present')
    const privateChild = await fetch(`${baseUrl}/api/parents/me/children/${otherStudentId}/attendance`, { headers: { Cookie: sessionCookie(user) } })
    assert.equal(privateChild.status, 404)
    assert.equal((await privateChild.json()).code, 'child_not_found')
  })
  assert.equal(calls.length, 7)
})

test('a school account cannot read a different school detail by changing the URL id', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))
  const ownSchoolId = '00000000-0000-4000-8000-000000000021'
  const otherSchoolId = '00000000-0000-4000-8000-000000000022'
  const user = { id: '00000000-0000-4000-8000-000000000023', email: 'admin@example.test', display_name: 'School Admin', role: 'school_admin', school_id: ownSchoolId, district_scope: null, session_version: 1, preferred_language: 'en', active: true, school_district: 'District A' }

  await withPoolQueryMock(async (sql, params) => {
    if (sql.includes('FROM users u LEFT JOIN schools')) return { rows: [user] }
    if (sql.includes('FROM schools s LEFT JOIN school_classes c')) {
      assert.match(sql, /s\.id = \$1 AND s\.id = \$2/)
      assert.deepEqual(params, [otherSchoolId, ownSchoolId])
      return { rows: [] }
    }
    throw new Error(`Unexpected SQL in school isolation test: ${sql}`)
  }, async () => {
    const response = await fetch(`${baseUrl}/api/schools/${otherSchoolId}`, { headers: { Cookie: sessionCookie(user) } })
    assert.equal(response.status, 404)
    assert.equal((await response.json()).code, 'school_not_found')
  })
})

test('a school administrator cannot use department-only school verification actions', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))
  const user = { id: '00000000-0000-4000-8000-000000000031', email: 'admin@example.test', display_name: 'School Admin', role: 'school_admin', school_id: '00000000-0000-4000-8000-000000000032', district_scope: null, session_version: 1, preferred_language: 'en', active: true, school_district: 'District A' }

  await withPoolQueryMock(async (sql) => {
    if (sql.includes('FROM users u LEFT JOIN schools')) return { rows: [user] }
    throw new Error(`Verification role denial should stop before this query: ${sql}`)
  }, async () => {
    const response = await fetch(`${baseUrl}/api/schools/00000000-0000-4000-8000-000000000033/verification`, {
      method: 'PATCH',
      headers: { Cookie: sessionCookie(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'verified' }),
    })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, 'insufficient_role')
  })
})

test('roles cannot use management actions outside their permission scope', async (context) => {
  const { server, baseUrl } = await startTestServer()
  context.after(() => stopTestServer(server))
  const schoolId = '00000000-0000-4000-8000-000000000041'
  const cases = [
    { role: 'parent', method: 'POST', path: '/api/students', body: {} },
    { role: 'teacher', method: 'POST', path: '/api/users', body: {} },
    { role: 'principal', method: 'PATCH', path: '/api/users/00000000-0000-4000-8000-000000000042/status', body: { active: false } },
    { role: 'parent', method: 'POST', path: '/api/attendance/sync', body: {} },
  ]

  let currentUser
  await withPoolQueryMock(async (sql) => {
    if (sql.includes('FROM users u LEFT JOIN schools')) return { rows: [currentUser] }
    if (sql.includes('FROM parents WHERE user_id')) return { rows: [{ id: '00000000-0000-4000-8000-000000000043' }] }
    throw new Error(`Role denial should stop before the requested action: ${sql}`)
  }, async () => {
    for (const [index, item] of cases.entries()) {
      currentUser = {
        id: `00000000-0000-4000-8000-${String(index + 44).padStart(12, '0')}`,
        email: `${item.role}@example.test`,
        display_name: item.role,
        role: item.role,
        school_id: schoolId,
        district_scope: null,
        session_version: 1,
        preferred_language: 'en',
        active: true,
        school_district: 'District A',
      }
      const response = await fetch(`${baseUrl}${item.path}`, {
        method: item.method,
        headers: { Cookie: sessionCookie(currentUser), 'Content-Type': 'application/json' },
        body: JSON.stringify(item.body),
      })
      assert.equal(response.status, 403, `${item.role} must not call ${item.method} ${item.path}`)
      assert.equal((await response.json()).code, 'insufficient_role')
    }
  })
})
