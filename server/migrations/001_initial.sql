CREATE TABLE schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  district TEXT NOT NULL,
  block TEXT NOT NULL,
  address TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE RESTRICT,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'principal', 'school_admin', 'department', 'parent')),
  district_scope TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi')),
  session_version INTEGER NOT NULL DEFAULT 0,
  notification_preferences JSONB NOT NULL DEFAULT '{"absence":true,"attendance":true,"school_updates":true}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX users_school_role_idx ON users(school_id, role) WHERE active;

CREATE TABLE academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on > starts_on),
  UNIQUE (school_id, name)
);
CREATE UNIQUE INDEX academic_year_current_idx ON academic_years(school_id) WHERE is_current;

CREATE TABLE school_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  section TEXT NOT NULL,
  grade_level TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, academic_year_id, name, section),
  UNIQUE (id, school_id)
);
CREATE INDEX school_classes_school_idx ON school_classes(school_id, academic_year_id, grade_level);

CREATE TABLE teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  staff_code TEXT NOT NULL,
  subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, staff_code),
  UNIQUE (id, school_id)
);

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  class_id UUID NOT NULL,
  admission_number TEXT NOT NULL,
  display_name TEXT NOT NULL,
  gender TEXT CHECK (gender IN ('female', 'male', 'other', 'undisclosed')),
  active BOOLEAN NOT NULL DEFAULT true,
  enrolled_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, admission_number),
  UNIQUE (id, school_id),
  FOREIGN KEY (class_id, school_id) REFERENCES school_classes(id, school_id) ON DELETE RESTRICT
);
CREATE INDEX students_school_class_idx ON students(school_id, class_id) WHERE active;

CREATE TABLE parents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE parent_students (
  parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL DEFAULT 'guardian',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_id, student_id)
);
CREATE INDEX parent_students_student_idx ON parent_students(student_id);

CREATE TABLE teacher_class_assignments (
  teacher_id UUID NOT NULL,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  class_id UUID NOT NULL,
  starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, class_id, starts_on),
  FOREIGN KEY (teacher_id, school_id) REFERENCES teachers(id, school_id) ON DELETE RESTRICT,
  FOREIGN KEY (class_id, school_id) REFERENCES school_classes(id, school_id) ON DELETE RESTRICT,
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX teacher_assignments_class_idx ON teacher_class_assignments(class_id, starts_on, ends_on);

CREATE TABLE attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  class_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  state TEXT NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted', 'approved', 'rejected')),
  note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, class_id, attendance_date),
  UNIQUE (id, school_id),
  FOREIGN KEY (class_id, school_id) REFERENCES school_classes(id, school_id) ON DELETE RESTRICT
);
CREATE INDEX attendance_sessions_school_date_idx ON attendance_sessions(school_id, attendance_date DESC);
CREATE INDEX attendance_sessions_class_date_idx ON attendance_sessions(class_id, attendance_date DESC);

CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  school_id UUID NOT NULL,
  student_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  capture_method TEXT NOT NULL DEFAULT 'manual' CHECK (capture_method IN ('manual', 'qr', 'import')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id),
  FOREIGN KEY (session_id, school_id) REFERENCES attendance_sessions(id, school_id) ON DELETE RESTRICT,
  FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE RESTRICT
);
CREATE INDEX attendance_records_student_idx ON attendance_records(student_id, created_at DESC);
CREATE INDEX attendance_records_school_status_idx ON attendance_records(school_id, status, created_at DESC);

CREATE TABLE sync_idempotency (
  idempotency_key UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payload_hash TEXT NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  device_label TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_label)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id UUID REFERENCES schools(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_unread_idx ON notifications(recipient_user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  school_id UUID REFERENCES schools(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_school_created_idx ON audit_logs(school_id, created_at DESC);
CREATE INDEX audit_logs_actor_created_idx ON audit_logs(actor_id, created_at DESC);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'reset' CHECK (purpose IN ('reset', 'invite')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_user_idx ON password_reset_tokens(user_id, expires_at DESC);
