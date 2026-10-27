-- Part 15: physical merchandise returns, not cash refunds. Immutable earlier migrations.
-- Review requires a different staff member from the person receiving the return.
CREATE TABLE store_returns (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 sale_id BIGINT NOT NULL REFERENCES store_sales(id) ON DELETE RESTRICT,
 received_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_key_hash CHAR(64) NOT NULL UNIQUE,
 request_payload_hash CHAR(64) NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 500),
 status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','accepted','rejected')),
 reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
 reviewed_at TIMESTAMPTZ,
 refund_due NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(refund_due >= 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK ((status='pending_review')=(reviewed_by_user_id IS NULL AND reviewed_at IS NULL)),
 CHECK (status<>'accepted' OR reviewed_by_user_id <> received_by_user_id)
);
CREATE UNIQUE INDEX store_returns_one_pending_per_sale ON store_returns(sale_id) WHERE status='pending_review';
CREATE INDEX store_returns_sale_idx ON store_returns(sale_id,created_at DESC);
CREATE TABLE store_return_lines (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 return_id BIGINT NOT NULL REFERENCES store_returns(id) ON DELETE RESTRICT,
 sale_line_id BIGINT NOT NULL REFERENCES store_sale_lines(id) ON DELETE RESTRICT,
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 condition TEXT CHECK(condition IN ('resellable','damaged')),
 UNIQUE(return_id,sale_line_id)
);
ALTER TABLE store_stock_movements ADD COLUMN return_id BIGINT REFERENCES store_returns(id) ON DELETE RESTRICT;
-- The previous UNIQUE(sale_id,item_id) allowed one sale movement per line;
-- returns legitimately create further movements for the same sale/item.
ALTER TABLE store_stock_movements DROP CONSTRAINT store_stock_movements_sale_id_item_id_key;
CREATE UNIQUE INDEX store_sale_movements_unique ON store_stock_movements(sale_id,item_id) WHERE movement_type='sale';
ALTER TABLE store_stock_movements DROP CONSTRAINT store_stock_movements_movement_type_check;
ALTER TABLE store_stock_movements DROP CONSTRAINT store_stock_movements_check;
ALTER TABLE store_stock_movements ADD CONSTRAINT store_stock_movements_movement_type_check CHECK (movement_type IN ('receipt','sale','return'));
ALTER TABLE store_stock_movements ADD CONSTRAINT store_stock_movements_check CHECK (
 (movement_type='receipt' AND stock_receipt_id IS NOT NULL AND sale_id IS NULL AND return_id IS NULL AND quantity_delta>0)
 OR (movement_type='sale' AND stock_receipt_id IS NULL AND sale_id IS NOT NULL AND return_id IS NULL AND quantity_delta<0)
 OR (movement_type='return' AND stock_receipt_id IS NULL AND sale_id IS NOT NULL AND return_id IS NOT NULL AND quantity_delta>0)
);
CREATE UNIQUE INDEX store_stock_movements_return_per_item_idx ON store_stock_movements(return_id,item_id) WHERE return_id IS NOT NULL;
