-- The rate card's rows. The table came with 20260831070611_rate_card, but its
-- rows only ever came from prisma/seed-rate-card.js, which no deploy runs — so
-- production had no prices and a lead could not be marked Converted (no speed
-- to pick, nothing to price). Same 12 rows and effectiveFrom as that seed
-- (supplied 2026-08-31, confirmed with the owner 2026-10-06), rupees per
-- customer. ON CONFLICT DO NOTHING: a database that already has them (dev) is
-- unchanged, and a later re-price (a new effectiveFrom) is never overwritten.
INSERT INTO "RateCard" ("id", "speedMbps", "billingPeriod", "amount", "effectiveFrom", "createdAt")
SELECT gen_random_uuid()::text, v.speed, v.period::"BillingPeriod", v.amount, TIMESTAMP '2026-01-01 00:00:00', CURRENT_TIMESTAMP
FROM (VALUES
  (100, 'QUARTERLY', 375), (100, 'HALF_YEARLY', 750),  (100, 'YEARLY', 1200),
  (200, 'QUARTERLY', 450), (200, 'HALF_YEARLY', 900),  (200, 'YEARLY', 1500),
  (300, 'QUARTERLY', 525), (300, 'HALF_YEARLY', 1050), (300, 'YEARLY', 1800),
  (400, 'QUARTERLY', 600), (400, 'HALF_YEARLY', 1200), (400, 'YEARLY', 2100)
) AS v(speed, period, amount)
ON CONFLICT ("speedMbps", "billingPeriod", "effectiveFrom") DO NOTHING;
