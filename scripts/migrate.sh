#!/usr/bin/env bash
set -euo pipefail
echo "Running database migrations..."
cd packages/database
npx knex --knexfile knexfile.ts migrate:latest
echo "Migrations complete."
