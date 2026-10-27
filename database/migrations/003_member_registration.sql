-- Step 3: additive migration; do NOT modify previously applied migrations.
CREATE SEQUENCE member_number_seq START WITH 1;
ALTER TABLE members ALTER COLUMN membership_number
  SET DEFAULT ('MSC-' || lpad(nextval('member_number_seq')::text, 8, '0'));
-- The name + DOB index supports a staff-facing possible-duplicate warning.
-- It is intentionally NOT unique; people can share names and birthdays.
CREATE INDEX member_identity_review_idx ON members(lower(full_name), date_of_birth);
CREATE UNIQUE INDEX organization_name_type_unique ON organizations(lower(name), type);
CREATE INDEX members_created_idx ON members(created_at DESC, id DESC);
CREATE INDEX memberships_member_idx ON memberships(member_id);
CREATE TABLE idempotency_requests (
  actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL,
  key_hash CHAR(64) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  response_status INTEGER,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, operation, key_hash),
  CHECK ((response_status IS NULL) = (response_json IS NULL))
);
