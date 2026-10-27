-- MSCMS initial accounts, membership, sports and charges. PostgreSQL 14+.
-- Run through npm run db:migrate; don't paste into a public SQL console with real data.
CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 150),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_lower_email_uq ON users (lower(email));

CREATE TABLE roles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(3) NOT NULL UNIQUE CHECK (code IN ('ADM','REG','STO','PAT','CAP','FIN','MGT')),
  name TEXT NOT NULL
);
CREATE TABLE user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE staff_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX staff_sessions_user_active_idx ON staff_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE organizations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(btrim(name)) >= 2),
  type TEXT NOT NULL CHECK (type IN ('school','college','religious')),
  contact_name TEXT,
  contact_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE group_registrations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  submitted_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reference_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','posted','cancelled')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE members (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  membership_number TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 150),
  gender TEXT,
  date_of_birth DATE NOT NULL,
  phone TEXT,
  sub_county TEXT,
  school_or_college TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_consent','active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX members_name_search_idx ON members(lower(full_name));
CREATE TABLE member_contacts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('next_of_kin','guardian')),
  full_name TEXT NOT NULL,
  relationship TEXT,
  phone TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE guardian_consents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  guardian_contact_id BIGINT NOT NULL REFERENCES member_contacts(id) ON DELETE RESTRICT,
  consent_purpose TEXT NOT NULL DEFAULT 'club_membership',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','revoked')),
  verified_at TIMESTAMPTZ,
  verified_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  evidence_reference TEXT,
  CHECK ((status = 'verified') = (verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL))
);
CREATE TABLE member_support_details (
  member_id BIGINT PRIMARY KEY REFERENCES members(id) ON DELETE RESTRICT,
  weight_kg NUMERIC(5,2) CHECK (weight_kg > 0),
  height_cm NUMERIC(5,2) CHECK (height_cm > 0),
  special_needs_notes TEXT,
  purpose TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  registration_type TEXT NOT NULL CHECK (registration_type IN ('individual','group')),
  organization_id BIGINT REFERENCES organizations(id) ON DELETE RESTRICT,
  group_registration_id BIGINT REFERENCES group_registrations(id) ON DELETE RESTRICT,
  registered_on DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','cancelled')),
  CHECK ((registration_type = 'group' AND organization_id IS NOT NULL) OR
         (registration_type = 'individual' AND organization_id IS NULL AND group_registration_id IS NULL))
);
CREATE TABLE sports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE member_sport_preferences (
  member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  sport_id BIGINT NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  priority INTEGER NOT NULL CHECK (priority > 0),
  PRIMARY KEY(member_id, sport_id),
  UNIQUE(member_id, priority)
);
CREATE TABLE charges (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('membership','facilitation','surcharge')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'outstanding' CHECK (status IN ('outstanding','paid','void')),
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ
);
CREATE TABLE membership_charges (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  membership_id BIGINT NOT NULL UNIQUE REFERENCES memberships(id) ON DELETE RESTRICT,
  charge_id BIGINT NOT NULL UNIQUE REFERENCES charges(id) ON DELETE RESTRICT,
  fee_rate_snapshot NUMERIC(12,2) NOT NULL CHECK (fee_rate_snapshot IN (500.00,1000.00))
);
CREATE TABLE audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata_summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- A minor cannot be activated without verified guardian authorization.
-- Registration service must additionally validate the member's initial eligible age of 12–35.
CREATE FUNCTION enforce_minor_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active' AND date_part('year', age(CURRENT_DATE, NEW.date_of_birth)) < 18
     AND NOT EXISTS (
       SELECT 1 FROM guardian_consents c
       JOIN member_contacts mc ON mc.id=c.guardian_contact_id
       WHERE c.member_id=NEW.id AND mc.member_id=NEW.id
         AND mc.contact_type='guardian' AND c.status='verified'
     )
  THEN
    RAISE EXCEPTION 'Verified guardian consent required to activate minor';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER member_minor_activation_guard BEFORE INSERT OR UPDATE OF status, date_of_birth ON members
  FOR EACH ROW EXECUTE FUNCTION enforce_minor_activation();

-- Prevent changing verified consent for an active minor unless account is deactivated first.
CREATE FUNCTION prevent_active_minor_consent_loss() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='verified' AND (TG_OP='DELETE' OR NEW.status <> 'verified')
     AND EXISTS (SELECT 1 FROM members m WHERE m.id=OLD.member_id AND m.status='active'
       AND date_part('year', age(CURRENT_DATE, m.date_of_birth)) < 18)
     AND NOT EXISTS (
       SELECT 1 FROM guardian_consents c
       WHERE c.member_id=OLD.member_id AND c.status='verified' AND c.id<>OLD.id
     )
  THEN
    RAISE EXCEPTION 'Deactivate minor or verify another guardian before revoking last consent';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER minor_consent_loss_guard BEFORE UPDATE OF status OR DELETE ON guardian_consents
 FOR EACH ROW EXECUTE FUNCTION prevent_active_minor_consent_loss();
