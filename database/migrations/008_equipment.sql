-- MSCMS Part 8: loanable equipment is NOT store-sale inventory.
-- Each transition is recorded in one DB transaction with an auditable movement.
CREATE TABLE equipment_types (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  market_value NUMERIC(12,2) NOT NULL CHECK (market_value > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE equipment_balances (
  equipment_type_id BIGINT PRIMARY KEY REFERENCES equipment_types(id) ON DELETE RESTRICT,
  available_qty INTEGER NOT NULL DEFAULT 0 CHECK (available_qty >= 0),
  issued_qty INTEGER NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  damaged_qty INTEGER NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  missing_qty INTEGER NOT NULL DEFAULT 0 CHECK (missing_qty >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE equipment_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipment_type_id BIGINT NOT NULL REFERENCES equipment_types(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  source_reference TEXT NOT NULL CHECK (length(btrim(source_reference)) BETWEEN 3 AND 80),
  received_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(equipment_type_id,source_reference)
);
CREATE TABLE equipment_loans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  event_id BIGINT REFERENCES sporting_events(id) ON DELETE RESTRICT,
  captain_member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  requested_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_at TIMESTAMPTZ,
  due_date DATE NOT NULL,
  purpose TEXT NOT NULL CHECK (length(btrim(purpose)) BETWEEN 3 AND 200),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','issued','partially_returned','closed')),
  CHECK ((issued_at IS NOT NULL) = (issued_by_user_id IS NOT NULL))
);
CREATE INDEX equipment_loans_team_status_idx ON equipment_loans(team_id,status,id DESC);
CREATE TABLE equipment_loan_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id BIGINT NOT NULL REFERENCES equipment_loans(id) ON DELETE RESTRICT,
  equipment_type_id BIGINT NOT NULL REFERENCES equipment_types(id) ON DELETE RESTRICT,
  issued_qty INTEGER NOT NULL CHECK (issued_qty > 0),
  market_value_snapshot NUMERIC(12,2) CHECK(market_value_snapshot > 0),
  UNIQUE(loan_id,equipment_type_id)
);
CREATE TABLE equipment_returns (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id BIGINT NOT NULL REFERENCES equipment_loans(id) ON DELETE RESTRICT,
  inspected_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT CHECK (length(notes) <= 500)
);
CREATE TABLE equipment_return_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_id BIGINT NOT NULL REFERENCES equipment_returns(id) ON DELETE RESTRICT,
  loan_line_id BIGINT NOT NULL REFERENCES equipment_loan_lines(id) ON DELETE RESTRICT,
  usable_qty INTEGER NOT NULL DEFAULT 0 CHECK (usable_qty >= 0),
  damaged_qty INTEGER NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  missing_qty INTEGER NOT NULL DEFAULT 0 CHECK (missing_qty >= 0),
  CHECK (usable_qty + damaged_qty + missing_qty > 0),
  UNIQUE(return_id,loan_line_id)
);
CREATE INDEX equipment_returns_loan_idx ON equipment_returns(loan_id,id);
CREATE INDEX equipment_return_lines_loanline_idx ON equipment_return_lines(loan_line_id);
-- A report is not a charge. Approval captures disputed market valuation,
-- but allocating liability to named people is blocked until club policy exists.
CREATE TABLE equipment_incidents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_line_id BIGINT NOT NULL REFERENCES equipment_return_lines(id) ON DELETE RESTRICT,
  incident_type TEXT NOT NULL CHECK(incident_type IN ('damaged','missing')),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  status TEXT NOT NULL DEFAULT 'reported' CHECK(status IN ('reported','confirmed')),
  reported_market_value NUMERIC(12,2) NOT NULL CHECK(reported_market_value > 0),
  approved_market_value NUMERIC(12,2) CHECK(approved_market_value > 0),
  surcharge_total NUMERIC(12,2) CHECK(surcharge_total >= 0),
  evidence_reference TEXT CHECK(length(evidence_reference) <= 200),
  confirmed_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  UNIQUE(return_line_id,incident_type),
  CHECK ((status='confirmed')=(approved_market_value IS NOT NULL AND surcharge_total IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL))
);
CREATE TABLE equipment_movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipment_type_id BIGINT NOT NULL REFERENCES equipment_types(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('receipt','issue','return')),
  receipt_id BIGINT REFERENCES equipment_receipts(id) ON DELETE RESTRICT,
  loan_id BIGINT REFERENCES equipment_loans(id) ON DELETE RESTRICT,
  return_line_id BIGINT REFERENCES equipment_return_lines(id) ON DELETE RESTRICT,
  available_delta INTEGER NOT NULL DEFAULT 0,
  issued_delta INTEGER NOT NULL DEFAULT 0,
  damaged_delta INTEGER NOT NULL DEFAULT 0,
  missing_delta INTEGER NOT NULL DEFAULT 0,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (available_delta<>0 OR issued_delta<>0 OR damaged_delta<>0 OR missing_delta<>0),
  CHECK ((movement_type='receipt' AND receipt_id IS NOT NULL AND loan_id IS NULL AND return_line_id IS NULL AND available_delta>0 AND issued_delta=0 AND damaged_delta=0 AND missing_delta=0)
      OR (movement_type='issue' AND loan_id IS NOT NULL AND receipt_id IS NULL AND return_line_id IS NULL AND available_delta<0 AND issued_delta=-available_delta AND damaged_delta=0 AND missing_delta=0)
      OR (movement_type='return' AND return_line_id IS NOT NULL AND receipt_id IS NULL AND loan_id IS NULL AND issued_delta=-(available_delta+damaged_delta+missing_delta) AND issued_delta<0 AND available_delta>=0 AND damaged_delta>=0 AND missing_delta>=0)),
  UNIQUE(receipt_id), UNIQUE(loan_id,equipment_type_id), UNIQUE(return_line_id)
);
CREATE INDEX equipment_movements_item_idx ON equipment_movements(equipment_type_id,created_at DESC);
