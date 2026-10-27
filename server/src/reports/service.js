import { parseReportRange, sumMoney } from './policy.js';

const cashFlowCTE = `WITH cash_events AS (
  -- When payment is later reversed, original verification and reversal remain
  -- separate signed cashflow events. Reversed receipts are not counted twice.
  SELECT c.charge_type AS source, p.method, a.amount AS delta, p.verified_at AS event_at
  FROM payments p JOIN payment_allocations a ON a.payment_id=p.id
  JOIN charges c ON c.id=a.charge_id
  WHERE p.status IN ('verified','reversed') AND p.verified_at >= $1::timestamptz AND p.verified_at < $2::timestamptz
  UNION ALL
  SELECT c.charge_type, p.method, -a.amount, p.reversed_at
  FROM payments p JOIN payment_allocations a ON a.payment_id=p.id
  JOIN charges c ON c.id=a.charge_id
  WHERE p.status='reversed' AND p.reversed_at >= $1::timestamptz AND p.reversed_at < $2::timestamptz
  UNION ALL
  -- Store sales never appear in payments/payment_allocations.
  SELECT 'store_sale',t.method,s.total,s.completed_at
  FROM store_sales s JOIN store_sale_tenders t ON t.sale_id=s.id
  WHERE s.status='completed' AND t.status='verified'
    AND s.completed_at >= $1::timestamptz AND s.completed_at < $2::timestamptz
)`;

export const reportSql = {
  income: `${cashFlowCTE}
  SELECT source,method,COALESCE(COUNT(*),0)::int AS entries,
    COALESCE(SUM(delta),0)::numeric(14,2)::text AS net_amount
  FROM cash_events GROUP BY source,method ORDER BY source,method`,
  ageBands: `SELECT CASE
      WHEN EXTRACT(YEAR FROM age(ms.registered_on,m.date_of_birth)) BETWEEN 12 AND 17 THEN '12-17'
      WHEN EXTRACT(YEAR FROM age(ms.registered_on,m.date_of_birth)) BETWEEN 18 AND 25 THEN '18-25'
      WHEN EXTRACT(YEAR FROM age(ms.registered_on,m.date_of_birth)) BETWEEN 26 AND 35 THEN '26-35'
      ELSE 'outside-enrollment-range' END AS age_band, COUNT(*)::int AS registrations
    FROM memberships ms JOIN members m ON m.id=ms.member_id
    WHERE ms.registered_on >= $3::date AND ms.registered_on <= $4::date
    GROUP BY age_band ORDER BY age_band`,
  sports: `SELECT s.name AS sport,s.is_active AS active, u.full_name AS current_patron,
    (SELECT COUNT(*)::int FROM member_sport_preferences pref WHERE pref.sport_id=s.id) AS interested_members,
    (SELECT COUNT(*)::int FROM teams t WHERE t.sport_id=s.id AND t.status='active') AS active_teams,
    (SELECT COUNT(*)::int FROM team_captain_assignments ca JOIN teams t ON t.id=ca.team_id
      WHERE t.sport_id=s.id AND t.status='active' AND ca.ended_at IS NULL) AS active_captains
    FROM sports s LEFT JOIN sport_patron_assignments a ON a.sport_id=s.id AND a.ended_at IS NULL
    LEFT JOIN users u ON u.id=a.user_id ORDER BY s.name LIMIT 201`,
  membership: `SELECT ms.registration_type AS category, COUNT(*)::int AS registrations,
    COUNT(*) FILTER (WHERE ms.status='active')::int AS active_now,
    COALESCE(SUM(c.amount),0)::numeric(14,2)::text AS billed,
    COALESCE(SUM(COALESCE(paid.collected,0)),0)::numeric(14,2)::text AS collected_lifetime
    FROM memberships ms JOIN membership_charges mc ON mc.membership_id=ms.id
    JOIN charges c ON c.id=mc.charge_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(a.amount),0) AS collected FROM payment_allocations a
      JOIN payments p ON p.id=a.payment_id WHERE a.charge_id=c.id AND p.status='verified'
    ) paid ON TRUE
    WHERE ms.registered_on >= $3::date AND ms.registered_on <= $4::date
    GROUP BY ms.registration_type ORDER BY ms.registration_type`,
  sales: `SELECT COUNT(*)::int AS completed_sales,
    COALESCE(SUM(s.subtotal),0)::numeric(14,2)::text AS subtotal,
    COALESCE(SUM(s.discount),0)::numeric(14,2)::text AS discount,
    COALESCE(SUM(s.total),0)::numeric(14,2)::text AS total,
    COUNT(*) FILTER(WHERE t.method='cash')::int AS cash_sales,
    COUNT(*) FILTER(WHERE t.method='mobile_money')::int AS mobile_sales
    FROM store_sales s JOIN store_sale_tenders t ON t.sale_id=s.id AND t.status='verified'
    WHERE s.status='completed' AND s.completed_at >= $1::timestamptz AND s.completed_at < $2::timestamptz`,
  saleProducts: `SELECT l.sku_snapshot AS sku,l.name_snapshot AS name,
    SUM(l.qty)::int AS units,
    COALESCE(SUM(l.line_total),0)::numeric(14,2)::text AS gross_sales
    FROM store_sale_lines l JOIN store_sales s ON s.id=l.sale_id
    WHERE s.status='completed' AND s.completed_at >= $1::timestamptz AND s.completed_at < $2::timestamptz
    GROUP BY l.sku_snapshot,l.name_snapshot ORDER BY units DESC,sku LIMIT 100`,
  inventory: `WITH movements AS (
    SELECT item_id,
    COALESCE(SUM(quantity_delta) FILTER(WHERE movement_type='receipt'),0)::int AS received_in_period,
    COALESCE(-SUM(quantity_delta) FILTER(WHERE movement_type='sale'),0)::int AS sold_in_period
    FROM store_stock_movements
    WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
    GROUP BY item_id
  ) SELECT i.sku,i.name,i.variant,i.unit_price::text AS unit_price,
    inv.available_qty,i.max_stock_level,(inv.available_qty * 5 <= i.max_stock_level) AS low_stock,
    COALESCE(m.received_in_period,0)::int AS received_in_period,
    COALESCE(m.sold_in_period,0)::int AS sold_in_period
    FROM store_items i JOIN store_inventory inv ON inv.item_id=i.id
    LEFT JOIN movements m ON m.item_id=i.id ORDER BY i.sku LIMIT 201`,
  events: `WITH fee_totals AS (
    SELECT ep.event_id,COUNT(*)::int AS participants,
    COALESCE(SUM(c.amount),0)::numeric(14,2) AS billed,
    COALESCE(SUM(COALESCE(paid.collected,0)),0)::numeric(14,2) AS collected
    FROM event_participants ep
    LEFT JOIN charges c ON c.id=ep.charge_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(a.amount),0) AS collected FROM payment_allocations a
      JOIN payments p ON p.id=a.payment_id WHERE a.charge_id=c.id AND p.status='verified'
    ) paid ON TRUE GROUP BY ep.event_id
  ) SELECT e.id::text AS id, e.event_date::text AS event_date,
    sp.name AS sport,t.name AS team,e.event_type,e.status,
    COALESCE(f.participants,0)::int AS participants,
    COALESCE(f.billed,0)::numeric(14,2)::text AS assessed_fees,
    COALESCE(f.collected,0)::numeric(14,2)::text AS collected_lifetime,
    (ROUND(COALESCE(f.billed,0)*0.20,2))::text AS commission_on_assessed,
    (ROUND(COALESCE(f.collected,0)*0.20,2))::text AS commission_on_collected
    FROM sporting_events e JOIN sports sp ON sp.id=e.sport_id JOIN teams t ON t.id=e.team_id
    LEFT JOIN fee_totals f ON f.event_id=e.id
    WHERE e.event_date >= $3::date AND e.event_date <= $4::date
    ORDER BY e.event_date DESC,e.id DESC LIMIT 101`,
  equipmentBalances: `SELECT et.code,et.name,b.available_qty,b.issued_qty,b.damaged_qty,b.missing_qty
    FROM equipment_types et JOIN equipment_balances b ON b.equipment_type_id=et.id
    ORDER BY et.code LIMIT 201`,
  equipmentLoans: `SELECT COUNT(*) FILTER (WHERE issued_at >= $1::timestamptz AND issued_at < $2::timestamptz)::int AS issued_in_period,
    COUNT(*) FILTER (WHERE status IN ('issued','partially_returned') AND due_date<CURRENT_DATE)::int AS overdue_now,
    COUNT(*) FILTER (WHERE status IN ('issued','partially_returned'))::int AS outstanding_now
    FROM equipment_loans`,
  equipmentIncidents: `SELECT COUNT(*) FILTER(WHERE status='reported' AND er.inspected_at >= $1::timestamptz AND er.inspected_at < $2::timestamptz)::int AS reported_in_period,
    COUNT(*) FILTER(WHERE status='confirmed' AND ei.confirmed_at >= $1::timestamptz AND ei.confirmed_at < $2::timestamptz)::int AS confirmed_in_period,
    COALESCE(SUM(ei.surcharge_total) FILTER (WHERE ei.status='confirmed' AND ei.confirmed_at >= $1::timestamptz AND ei.confirmed_at < $2::timestamptz),0)::numeric(14,2)::text AS assessed_surcharge_in_period
    FROM equipment_incidents ei JOIN equipment_return_lines erl ON erl.id=ei.return_line_id
    JOIN equipment_returns er ON er.id=erl.return_id`
};

async function run(pool, name, params) {
  const result = await pool.query(reportSql[name],params);
  return result.rows;
}
function basic(type,period){return {type,period:{from:period.from,to:period.to,timeZone:'Africa/Nairobi'}};}

export async function getReport(pool,kind,rawQuery={},now=new Date()) {
  const period = parseReportRange(rawQuery,now);
  const params=period.params;
  if (kind==='income' || kind==='overview') {
    const entries = await run(pool,'income',params);
    const sources = ['membership','facilitation','store_sale','surcharge'].map(source=>({
      source, netCollected:sumMoney(entries.filter(e=>e.source===source).map(e=>e.net_amount))
    }));
    const byMethod=['cash','mobile_money'].map(method=>({
      method,netCollected:sumMoney(entries.filter(e=>e.method===method).map(e=>e.net_amount))
    }));
    return {...basic(kind,period),netCollected:sumMoney(sources.map(s=>s.netCollected)),sources,byMethod,
      bookedCommissionExpense:null,netProfit:null,
      notes:[
        'Net recorded collections: verified payments and completed sales within Nairobi date boundaries, minus dated accounting reversals. This is not a bank statement reconciliation.',
        'Store tenders are counted only once, from completed store sales; membership and event receipts come from the charge-payment ledger.',
        'A past verification and a later reversal are separate dated events. A period can show negative net receipts.',
        'Patron commissions are provisional, not booked expenses. No profit or net-after-expenses figure is presented.'
      ]};
  }
  if(kind==='memberships'){
    const [rows,ageBands]=await Promise.all([run(pool,'membership',params),run(pool,'ageBands',params)]);
    return {...basic(kind,period),ageBands,categories:rows.map(r=>({category:r.category,registrations:r.registrations,
      activeNow:r.active_now,billed:r.billed,collectedLifetime:r.collected_lifetime,
      balanceNow:sumMoney([r.billed,`-${r.collected_lifetime}`])})),
      note:'Cohort report: registrations and charges from dates selected; collectedLifetime and activeNow are as of now. For cash collected during the period use Income.'};
  }
  if(kind==='sports'){
    const all=await run(pool,'sports',params);
    return {...basic(kind,period),asOf:'current',sports:all.slice(0,200),truncated:all.length>200,
      note:'Current sports interests, active teams, captains and patron assignments. These are snapshots, not counts from the selected period.'};
  }
  if(kind==='sales'){
    const [summary,products]=await Promise.all([run(pool,'sales',params),run(pool,'saleProducts',params)]);
    return {...basic(kind,period),summary:summary[0],products,
      note:'Only completed, verified-tender sales count. Product gross sales are before whole-sale discounts; completed sales totals include discounts.'};
  }
  if(kind==='inventory'){
    const all=await run(pool,'inventory',params);
    return {...basic(kind,period),asOf:'current',items:all.slice(0,200),truncated:all.length>200,
      note:'Available stock and reorder thresholds are current snapshots; received/sold movement totals relate to the selected period. This is separate from loanable equipment.'};
  }
  if(kind==='events'){
    const all=await run(pool,'events',params);
    return {...basic(kind,period),events:all.slice(0,100),truncated:all.length>100,
      note:'Event date selects the event cohort; collectedLifetime is verified payments against its charges as of now. Both 20% commission figures are estimates only; no payout is authorized.'};
  }
  if(kind==='equipment'){
    const [all,loans,incidents]=await Promise.all([
      run(pool,'equipmentBalances',params),run(pool,'equipmentLoans',params),run(pool,'equipmentIncidents',params)]);
    return {...basic(kind,period),balances:all.slice(0,200),truncated:all.length>200,
      loans:loans[0],incidents:incidents[0],
      note:'Equipment balances and overdue status are current snapshots. Approved 110% assessments are NOT collected revenue or assigned personal debt.'};
  }
  throw new Error('Unsupported report kind');
}
