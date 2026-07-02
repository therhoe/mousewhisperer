#!/usr/bin/env sh
set -u

attempt=1
max_attempts="${PRISMA_MIGRATE_ATTEMPTS:-4}"
base_delay="${PRISMA_MIGRATE_RETRY_SECONDS:-3}"

while [ "$attempt" -le "$max_attempts" ]; do
  if npx prisma migrate deploy; then
    exit 0
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    exit 1
  fi

  next_attempt=$((attempt + 1))
  delay=$((base_delay * attempt))
  echo "Prisma migrate deploy failed. Retrying in ${delay}s (${next_attempt}/${max_attempts})..."
  sleep "$delay"
  attempt="$next_attempt"
done
