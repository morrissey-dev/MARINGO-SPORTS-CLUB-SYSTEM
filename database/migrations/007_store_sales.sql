-- MSCMS Part 7: product catalogue, receipts, stock ledger and sale settlement.
-- Additive: do not alter migrations 001-006. Values are in KSh NUMERIC(12,2).
CREATE TABLE store_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku VARCHAR(40) NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  variant TEXT,
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price > 0),
  max_stock_level INTEGER NOT NULL CHECK (max_stock_level > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE store_inventory (
  item_id BIGINT PRIMARY KEY REFERENCES store_items(id) ON DELETE RESTRICT,
  available_qty INTEGER NOT NULL DEFAULT 0 CHECK (available_qty >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE stock_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES store_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  source_reference TEXT NOT NULL CHECK (length(btrim(source_reference)) BETWEEN 3 AND 80),
  received_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_key_hash CHAR(64) NOT NULL UNIQUE,
  UNIQUE(item_id,source_reference)
);
CREATE TABLE store_sales (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  buyer_member_id BIGINT REFERENCES members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_mobile','completed','cancelled')),
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal > 0),
  discount NUMERIC(12,2) NOT NULL CHECK (discount >= 0),
  total NUMERIC(12,2) NOT NULL CHECK (total > 0 AND total = subtotal - discount),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX store_sales_status_idx ON store_sales(status,created_at DESC);
CREATE TABLE store_sale_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES store_sales(id) ON DELETE RESTRICT,
  item_id BIGINT NOT NULL REFERENCES store_items(id) ON DELETE RESTRICT,
  sku_snapshot TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK(qty > 0),
  unit_price_snapshot NUMERIC(12,2) NOT NULL CHECK (unit_price_snapshot > 0),
  line_total NUMERIC(12,2) NOT NULL CHECK (line_total = unit_price_snapshot * qty),
  UNIQUE (sale_id,item_id)
);
CREATE TABLE store_sale_tenders (
  sale_id BIGINT PRIMARY KEY REFERENCES store_sales(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('cash','mobile_money')),
  reference TEXT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','verified')),
  recorded_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ,
  verification_evidence TEXT,
  CHECK ((status='verified')=(verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL)),
  CHECK ((method='mobile_money' AND reference IS NOT NULL) OR (method='cash' AND reference IS NULL)),
  CHECK (amount > 0)
);
CREATE UNIQUE INDEX store_tender_mobile_reference_uq ON store_sale_tenders(upper(reference)) WHERE method='mobile_money';
CREATE TABLE store_stock_movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES store_items(id) ON DELETE RESTRICT,
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('receipt','sale')),
  stock_receipt_id BIGINT REFERENCES stock_receipts(id) ON DELETE RESTRICT,
  sale_id BIGINT REFERENCES store_sales(id) ON DELETE RESTRICT,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((movement_type='receipt' AND stock_receipt_id IS NOT NULL AND sale_id IS NULL AND quantity_delta>0)
      OR (movement_type='sale' AND stock_receipt_id IS NULL AND sale_id IS NOT NULL AND quantity_delta<0)),
  UNIQUE(stock_receipt_id), UNIQUE(sale_id,item_id)
);
CREATE INDEX store_movements_item_idx ON store_stock_movements(item_id,created_at DESC);
-- Exact listed prices; sports shoes are KSh 1,000–4,000 and require variant-specific SKUs set by staff.
-- max_stock_level=100 is a CONFIGURABLE demo reorder benchmark, not a reported club capacity.
INSERT INTO store_items(sku,name,unit_price,max_stock_level) VALUES
 ('BLOOMER','Bloomer',250.00,100),('GAMES-SHORTS','Games shorts',750.00,100),
 ('HOCKEY-STICK','Hockey stick',2000.00,100),('SOCKS','Socks',350.00,100),
 ('TRACK-SUIT','Track suit',1000.00,100),('TSHIRT','T-shirt',800.00,100),
 ('WRAPPER','Wrapper',450.00,100);
INSERT INTO store_inventory(item_id) SELECT id FROM store_items;
