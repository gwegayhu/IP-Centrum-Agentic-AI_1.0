#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        IP Centrum Agentic AI Platform — Setup        ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"
command -v node >/dev/null 2>&1 || { echo -e "${RED}Node.js 20+ required${NC}"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo -e "${YELLOW}Installing pnpm...${NC}"; npm install -g pnpm@9; }
command -v docker >/dev/null 2>&1 || { echo -e "${RED}Docker required${NC}"; exit 1; }
echo -e "${GREEN}✓ Prerequisites OK${NC}"

# .env setup
if [ ! -f .env ]; then
  echo -e "${YELLOW}Creating .env from .env.example...${NC}"
  cp .env.example .env
  echo -e "${GREEN}✓ .env created — FILL IN YOUR SECRETS BEFORE RUNNING${NC}"
  echo -e "${RED}  Required: ANTHROPIC_API_KEY, EPO_OPS_KEY, EPO_OPS_SECRET${NC}"
else
  echo -e "${GREEN}✓ .env exists${NC}"
fi

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
pnpm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Start infrastructure
echo -e "${YELLOW}Starting Docker services (postgres + redis)...${NC}"
docker-compose -f infrastructure/docker/docker-compose.yml up -d postgres redis
echo -e "${YELLOW}Waiting for postgres to be ready...${NC}"
until docker exec ip-centrum-postgres pg_isready -U ipcentrum -d ipcentrum_db >/dev/null 2>&1; do
  echo -n "."; sleep 1
done
echo ""
echo -e "${GREEN}✓ Postgres ready${NC}"

# Build shared packages
echo -e "${YELLOW}Building shared packages...${NC}"
pnpm --filter @ip-centrum/shared build
pnpm --filter @ip-centrum/database build
pnpm --filter @ip-centrum/event-bus build
echo -e "${GREEN}✓ Packages built${NC}"

# Run migrations
echo -e "${YELLOW}Running database migrations...${NC}"
pnpm db:migrate
echo -e "${GREEN}✓ Migrations complete${NC}"

# Seed development data
echo -e "${YELLOW}Seeding development data...${NC}"
pnpm db:seed
echo -e "${GREEN}✓ Dev data seeded${NC}"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                  Setup Complete!                     ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Start dev:     ${BLUE}pnpm dev${NC}"
echo -e "  API:           ${BLUE}http://localhost:3000${NC}"
echo -e "  Frontend:      ${BLUE}http://localhost:3001${NC}"
echo -e "  Health check:  ${BLUE}http://localhost:3000/health${NC}"
echo -e "  PgAdmin:       ${BLUE}docker-compose ... --profile dev-tools up${NC}"
echo ""
echo -e "${YELLOW}Remember: Set ANTHROPIC_API_KEY in .env${NC}"
