#!/bin/sh
# Apply DB migrations before the API starts, then (optionally) seed.
set -e

echo "→ Applying database migrations…"
npx prisma migrate deploy

# One-time seeding of the first admin, sample zones and building types.
# Set RUN_SEED=true on the FIRST deploy only (the seed is idempotent, but
# leaving it on would resurrect zones/types you later delete).
if [ "$RUN_SEED" = "true" ]; then
  echo "→ Seeding baseline data…"
  npx prisma db seed
fi

echo "→ Starting API…"
exec node src/server.js
