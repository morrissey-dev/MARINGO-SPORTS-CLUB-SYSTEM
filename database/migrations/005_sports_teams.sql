-- MSCMS Part 5: additive sports, teams, patrons and captain history.
-- Do not alter already-applied migrations 001-004.
CREATE TABLE sport_patron_assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport_id BIGINT NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  appointed_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX one_current_patron_per_sport ON sport_patron_assignments(sport_id) WHERE ended_at IS NULL;
CREATE INDEX patron_user_current_idx ON sport_patron_assignments(user_id, sport_id) WHERE ended_at IS NULL;

CREATE TABLE teams (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport_id BIGINT NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX team_name_per_sport_uq ON teams(sport_id, lower(name));
CREATE INDEX teams_by_sport_idx ON teams(sport_id, id);

CREATE TABLE team_members (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  added_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  CHECK (left_at IS NULL OR left_at >= joined_at)
);
CREATE UNIQUE INDEX active_team_member_uq ON team_members(team_id,member_id) WHERE left_at IS NULL;
CREATE INDEX active_member_teams_idx ON team_members(member_id) WHERE left_at IS NULL;

CREATE TABLE team_captain_assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  appointed_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX active_captain_per_team_uq ON team_captain_assignments(team_id) WHERE ended_at IS NULL;
CREATE INDEX captain_member_history_idx ON team_captain_assignments(member_id, team_id);
