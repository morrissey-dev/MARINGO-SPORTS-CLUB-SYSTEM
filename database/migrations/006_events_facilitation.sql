-- Step 6: events, participants, external facilitation charges and provisional commissions.
-- Additive migration: do not change applied migrations 001-005.
CREATE TABLE sporting_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport_id BIGINT NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  patron_assignment_id BIGINT NOT NULL REFERENCES sport_patron_assignments(id) ON DELETE RESTRICT,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('internal','external')),
  event_date DATE NOT NULL,
  venue TEXT NOT NULL CHECK(length(btrim(venue)) BETWEEN 2 AND 150),
  opponent TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  CHECK (event_type <> 'external' OR (opponent IS NOT NULL AND length(btrim(opponent)) >= 2)),
  CHECK ((status = 'finalized') = (finalized_at IS NOT NULL))
);
CREATE INDEX events_sport_date_idx ON sporting_events(sport_id,event_date DESC,id DESC);
CREATE INDEX events_team_date_idx ON sporting_events(team_id,event_date DESC);

CREATE TABLE event_participants (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES sporting_events(id) ON DELETE RESTRICT,
  member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  charge_id BIGINT UNIQUE REFERENCES charges(id) ON DELETE RESTRICT,
  enrolled_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id,member_id)
);
CREATE INDEX event_participants_member_idx ON event_participants(member_id,event_id);

CREATE TABLE facilitation_charges (
  charge_id BIGINT PRIMARY KEY REFERENCES charges(id) ON DELETE RESTRICT,
  event_participant_id BIGINT NOT NULL UNIQUE REFERENCES event_participants(id) ON DELETE RESTRICT,
  fee_snapshot NUMERIC(12,2) NOT NULL CHECK(fee_snapshot=500.00)
);

-- Patron compensation basis remains open: billed vs verified/collected.
-- No payable commission and no payout can be booked automatically.
CREATE TABLE patron_commission_projections (
  event_id BIGINT PRIMARY KEY REFERENCES sporting_events(id) ON DELETE RESTRICT,
  patron_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rate_percent NUMERIC(5,2) NOT NULL DEFAULT 20.00 CHECK(rate_percent=20.00),
  policy_basis TEXT NOT NULL DEFAULT 'undecided' CHECK(policy_basis='undecided'),
  status TEXT NOT NULL DEFAULT 'provisional' CHECK(status='provisional'),
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
