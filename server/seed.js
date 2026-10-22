import bcrypt from 'bcryptjs'
import { pool, closeDatabase } from './db.js'

const password = process.env.SEED_PASSWORD
if (process.env.NODE_ENV === 'production') throw new Error('The demo seed script is disabled in production.')
if (!password || password.length < 12) throw new Error('Set SEED_PASSWORD to a unique password of at least 12 characters before seeding.')

const school = { name: 'Nandipur Primary School (Demo)', code: 'DEMO-NANDIPUR', district: 'Sitamarhi', block: 'Riga' }
const users = [
  { key: 'teacher', email: process.env.SEED_TEACHER_EMAIL ?? 'teacher@ruralattend.demo', name: 'Sita Kumari', role: 'teacher' },
  { key: 'principal', email: process.env.SEED_PRINCIPAL_EMAIL ?? 'principal@ruralattend.demo', name: 'Anil Verma', role: 'principal' },
  { key: 'admin', email: process.env.SEED_ADMIN_EMAIL ?? 'admin@ruralattend.demo', name: 'Maya Singh', role: 'school_admin' },
  { key: 'parent', email: process.env.SEED_PARENT_EMAIL ?? 'parent@ruralattend.demo', name: 'Ravi Sharma', role: 'parent' },
  { key: 'department', email: process.env.SEED_DEPARTMENT_EMAIL ?? 'department@ruralattend.demo', name: 'Neha Rao', role: 'department', districtScope: 'Sitamarhi' },
]
const classSeed = [
  { name: 'Class V', section: 'A', grade: '5', teacher: 'teacher' },
  { name: 'Class IV', section: 'A', grade: '4', teacher: 'teacher' },
]
const studentSeed = [
  ['ST-104', 'Aarav Sharma', 'Class V', 'A', 'parent'],
  ['ST-108', 'Anaya Patel', 'Class V', 'A'],
  ['ST-112', 'Dev Kumar', 'Class V', 'A'],
  ['ST-117', 'Isha Devi', 'Class V', 'A'],
  ['ST-121', 'Kabir Singh', 'Class V', 'A'],
  ['ST-126', 'Meera Joshi', 'Class V', 'A'],
  ['ST-131', 'Rohan Das', 'Class V', 'A'],
  ['ST-135', 'Sana Khan', 'Class V', 'A'],
  ['ST-208', 'Diya Sharma', 'Class IV', 'A', 'parent'],
  ['ST-212', 'Ibrahim Khan', 'Class IV', 'A'],
  ['ST-217', 'Nisha Devi', 'Class IV', 'A'],
]

async function seed() {
  const connection = await pool.connect()
  try {
    await connection.query('BEGIN')
    const schoolResult = await connection.query(
      `INSERT INTO schools(name, code, district, block, verification_status)
       VALUES($1, $2, $3, $4, 'verified')
       ON CONFLICT(code) DO UPDATE SET name = EXCLUDED.name, district = EXCLUDED.district, block = EXCLUDED.block
       RETURNING id`,
      [school.name, school.code, school.district, school.block],
    )
    const schoolId = schoolResult.rows[0].id
    const yearResult = await connection.query(
      `INSERT INTO academic_years(school_id, name, starts_on, ends_on, is_current)
       VALUES($1, '2026-2027', '2026-04-01', '2027-03-31', true)
       ON CONFLICT(school_id, name) DO UPDATE SET is_current = true
       RETURNING id`,
      [schoolId],
    )
    const academicYearId = yearResult.rows[0].id
    const passwordHash = await bcrypt.hash(password, 12)
    const userIds = new Map()
    for (const user of users) {
      const result = await connection.query(
        `INSERT INTO users(school_id, email, display_name, password_hash, role, district_scope, active, activated_at)
         VALUES($1, $2, $3, $4, $5, $6, true, now())
         ON CONFLICT(email) DO UPDATE SET school_id = EXCLUDED.school_id, display_name = EXCLUDED.display_name,
           password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, district_scope = EXCLUDED.district_scope,
           active = true, activated_at = COALESCE(users.activated_at, now())
         RETURNING id`,
        [schoolId, user.email, user.name, passwordHash, user.role, user.districtScope ?? null],
      )
      userIds.set(user.key, result.rows[0].id)
    }

    const classIds = new Map()
    for (const schoolClass of classSeed) {
      const result = await connection.query(
        `INSERT INTO school_classes(school_id, academic_year_id, name, section, grade_level)
         VALUES($1, $2, $3, $4, $5)
         ON CONFLICT(school_id, academic_year_id, name, section) DO UPDATE SET grade_level = EXCLUDED.grade_level
         RETURNING id`,
        [schoolId, academicYearId, schoolClass.name, schoolClass.section, schoolClass.grade],
      )
      const classId = result.rows[0].id
      classIds.set(schoolClass.name, classId)
      const teacherResult = await connection.query(
        `INSERT INTO teachers(user_id, school_id, staff_code, subject)
         VALUES($1, $2, $3, $4)
         ON CONFLICT(user_id) DO UPDATE SET subject = EXCLUDED.subject
         RETURNING id`,
        [userIds.get(schoolClass.teacher), schoolId, `T-${schoolClass.grade}`, 'Class teacher'],
      )
      await connection.query(
        `INSERT INTO teacher_class_assignments(teacher_id, school_id, class_id)
         VALUES($1, $2, $3) ON CONFLICT DO NOTHING`,
        [teacherResult.rows[0].id, schoolId, classId],
      )
    }

    const parentResult = await connection.query('INSERT INTO parents(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING id', [userIds.get('parent')])
    const parentId = parentResult.rows[0].id
    for (const [admissionNumber, name, className, _section, parentKey] of studentSeed) {
      const classId = classIds.get(className)
      const studentResult = await connection.query(
        `INSERT INTO students(school_id, class_id, admission_number, display_name)
         VALUES($1, $2, $3, $4)
         ON CONFLICT(school_id, admission_number) DO UPDATE SET class_id = EXCLUDED.class_id, display_name = EXCLUDED.display_name, active = true
         RETURNING id`,
        [schoolId, classId, admissionNumber, name],
      )
      if (parentKey) {
        await connection.query(
          `INSERT INTO parent_students(parent_id, student_id) VALUES($1, $2) ON CONFLICT DO NOTHING`,
          [parentId, studentResult.rows[0].id],
        )
      }
    }

    await connection.query('COMMIT')
    console.info(`Seeded demo school ${school.code}. Login emails: ${users.map((user) => user.email).join(', ')}. All accounts use the supplied SEED_PASSWORD.`)
  } catch (error) {
    await connection.query('ROLLBACK')
    throw error
  } finally {
    connection.release()
  }
}

seed().catch((error) => {
  console.error('Database seed failed:', error.message)
  process.exitCode = 1
}).finally(closeDatabase)
