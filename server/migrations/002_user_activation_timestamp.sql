ALTER TABLE users ADD COLUMN activated_at TIMESTAMPTZ;

UPDATE users u
SET activated_at = COALESCE(
  (SELECT min(t.consumed_at)
   FROM password_reset_tokens t
   WHERE t.user_id = u.id AND t.purpose = 'invite' AND t.consumed_at IS NOT NULL),
  u.created_at
)
WHERE u.active = true
   OR EXISTS (
     SELECT 1 FROM password_reset_tokens t
     WHERE t.user_id = u.id AND t.purpose = 'invite' AND t.consumed_at IS NOT NULL
   );
