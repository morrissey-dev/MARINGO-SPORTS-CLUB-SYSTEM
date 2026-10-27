-- Part 16: verified refund disbursements, separate from physical merchandise returns.
-- One refund entitlement/attempt per accepted return; rejected requests cannot be silently reused.
CREATE TABLE store_refunds (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_id BIGINT NOT NULL UNIQUE REFERENCES store_returns(id) ON DELETE RESTRICT,
  sale_id BIGINT NOT NULL REFERENCES store_sales(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK(amount > 0),
  method TEXT NOT NULL CHECK(method IN ('cash','mobile_money')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','rejected')),
  reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 500),
  requested_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_key_hash CHAR(64) NOT NULL UNIQUE,
  request_payload_hash CHAR(64) NOT NULL,
  reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  evidence_reference VARCHAR(100),
  evidence_note TEXT,
  CHECK ((status='pending')=(reviewed_by_user_id IS NULL AND reviewed_at IS NULL)),
  CHECK (status<>'paid' OR (reviewed_by_user_id <> requested_by_user_id AND evidence_reference IS NOT NULL AND evidence_note IS NOT NULL)),
  CHECK (status<>'rejected' OR reviewed_by_user_id <> requested_by_user_id)
);
CREATE UNIQUE INDEX store_refunds_paid_evidence_unique ON store_refunds(upper(evidence_reference))
  WHERE status='paid';
CREATE INDEX store_refunds_status_date_idx ON store_refunds(status,reviewed_at DESC);
-- Ledger is append-only at the application level: only paid records are cash outflows.
-- Application locks the parent store_returns row before refund request or confirmation.
