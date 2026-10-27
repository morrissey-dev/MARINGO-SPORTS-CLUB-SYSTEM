-- Step 4 (additive). Earlier migrations 001-003 remain unchanged.
-- Recording a payment does not confirm it has been received.
CREATE TABLE payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  charge_id BIGINT NOT NULL REFERENCES charges(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  method TEXT NOT NULL CHECK (method IN ('cash','mobile_money')),
  transfer_reference VARCHAR(40),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','reversed','rejected')),
  recorded_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ,
  verification_reference VARCHAR(100),
  reversed_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  reversed_at TIMESTAMPTZ,
  reversal_reason TEXT,
  CHECK ((method='mobile_money' AND transfer_reference IS NOT NULL AND length(transfer_reference)>=6)
      OR (method='cash' AND transfer_reference IS NULL)),
  CHECK ((status IN ('verified','reversed')) = (verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL)),
  CHECK ((status='reversed') = (reversed_at IS NOT NULL AND reversed_by_user_id IS NOT NULL AND reversal_reason IS NOT NULL)),
  CHECK (verified_by_user_id IS NULL OR verified_by_user_id <> recorded_by_user_id)
);
-- Keep even a reversed reference reserved: a second record with it is suspicious.
CREATE UNIQUE INDEX payments_mobile_reference_unique ON payments(transfer_reference)
  WHERE method='mobile_money';
CREATE INDEX payments_status_recorded_idx ON payments(status, recorded_at DESC);
CREATE INDEX payments_charge_idx ON payments(charge_id, status);

-- The allocation ledger is append-only at the application level.
-- In this first slice one payment has one charge. Later it can be generalized.
CREATE TABLE payment_allocations (
  payment_id BIGINT PRIMARY KEY REFERENCES payments(id) ON DELETE RESTRICT,
  charge_id BIGINT NOT NULL REFERENCES charges(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_allocations_charge_idx ON payment_allocations(charge_id);
