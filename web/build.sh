#!/bin/sh
# Railway build script: substitutes API_URL into the production environment file before building
set -e

API_URL="${API_URL:-http://localhost:3000}"
sed -i "s|__API_URL__|${API_URL}|g" src/environments/environment.production.ts

pnpm install
pnpm build
