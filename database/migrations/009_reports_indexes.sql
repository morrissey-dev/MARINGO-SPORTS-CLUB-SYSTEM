-- Part 9: report index support only. Never rewrite transactional history.
-- Verification and reversal dates are indexed independently to preserve historical cashflow.
CREATE INDEX IF NOT EXISTS payments_verified_date_idx ON payments(verified_at)
  WHERE verified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_reversed_date_idx ON payments(reversed_at)
  WHERE reversed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_completed_date_idx ON store_sales(completed_at)
  WHERE status='completed';
CREATE INDEX IF NOT EXISTS events_event_date_idx ON sporting_events(event_date);
CREATE INDEX IF NOT EXISTS memberships_registered_date_idx ON memberships(registered_on);
CREATE INDEX IF NOT EXISTS equipment_incidents_confirmed_date_idx ON equipment_incidents(confirmed_at)
  WHERE confirmed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS equipment_loans_issued_date_idx ON equipment_loans(issued_at)
  WHERE issued_at IS NOT NULL;
