#!/bin/sh
set -e

echo "Applying database migrations..."
./node_modules/.bin/prisma migrate deploy

if [ "$RUN_SEED" = "true" ]; then
  echo "Seeding demo organizations..."
  ./node_modules/.bin/tsx prisma/seed.ts
fi

exec node dist/main.js
