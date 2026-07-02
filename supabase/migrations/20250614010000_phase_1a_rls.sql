-- Enable RLS
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users_read_own_profile"
ON users
FOR SELECT
USING (id = auth.uid());

-- Users can read users from their own institution
CREATE POLICY "users_read_same_institution"
ON users
FOR SELECT
USING (
  institution_id = (
    SELECT institution_id
    FROM users
    WHERE id = auth.uid()
  )
);

-- Users can read their own institution
CREATE POLICY "institutions_read_own"
ON institutions
FOR SELECT
USING (
  id = (
    SELECT institution_id
    FROM users
    WHERE users.id = auth.uid()
  )
);

-- Capabilities are readable by authenticated users
CREATE POLICY "capabilities_read_authenticated"
ON capabilities
FOR SELECT
TO authenticated
USING (true);

-- Users can read capabilities assigned within their institution
CREATE POLICY "user_capabilities_read_same_institution"
ON user_capabilities
FOR SELECT
USING (
  institution_id = (
    SELECT institution_id
    FROM users
    WHERE id = auth.uid()
  )
);

-- Audit logs readable only inside same institution
CREATE POLICY "audit_logs_read_same_institution"
ON audit_logs
FOR SELECT
USING (
  institution_id = (
    SELECT institution_id
    FROM users
    WHERE id = auth.uid()
  )
);