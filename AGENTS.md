# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

D365FO Middleware - A NestJS backend that serves as middleware between Excel-based data imports and Microsoft Dynamics 365 Finance & Operations (D365FO). The application transforms, validates, and posts financial data (vendor invoices, ledger journals, free-text invoices, etc.) to D365FO via OData APIs.

## Commands

```bash
# Install dependencies
pnpm install

# Development
pnpm run start:dev              # Watch mode
pnpm run start:debug            # Debug mode with watch

# Build
pnpm run build                  # Production build

# Lint & Format
pnpm run lint                   # ESLint with auto-fix
pnpm run format                 # Prettier

# Tests
pnpm run test                   # Unit tests (Jest)
pnpm run test:watch             # Watch mode
pnpm run test:cov               # Coverage report
pnpm run test:e2e               # End-to-end tests

# Docker (Development)
pnpm run docker:up              # Start containers
pnpm run docker:down            # Stop containers
pnpm run docker:logs            # Follow app logs
pnpm run docker:restart         # Restart containers

# Docker (Production)
pnpm run docker:prod:up         # Start production containers
pnpm run docker:prod:build      # Build production image
```

## Architecture

### Module Organization

```
src/
├── common/                     # Shared utilities (decorators, filters, interceptors, pipes)
├── config/                     # Configuration modules with Joi validation
├── lib/                        # Shared libraries
└── modules/
    ├── d365fo/                 # D365FO API client and services
    ├── queue/                  # BullMQ job processing (Redis)
    ├── resilience/             # Circuit breaker, retry, caching services
    ├── db/                     # MongoDB connection and global schemas
    ├── data-batch/             # Batch management (CQRS: commands, queries, repositories)
    ├── entry-processor/        # Data transformation processors
    ├── master-data/            # Financial dimensions, accounts cache
    └── [domain modules]/       # vendor, cash-in, cash-out, ledger, accounts-receivable, etc.
```

### Key Patterns

**CQRS Pattern**: Domain modules use Command/Query separation via `@nestjs/cqrs`
- Commands in `commands/` with handlers in `commands/handlers/`
- Queries in `queries/` with handlers in `queries/handlers/`

**Entry Processor Pattern**: Transforms raw Excel data → D365FO format
- Base class: `src/modules/entry-processor/processors/base/entry-processor.base.ts`
- Register new processors in `entry-processor.factory.ts` and `entry-processors.module.ts`
- Rules: MAX 1000 lines/batch, month isolation, never split vouchers

**Strategy Pattern**: DFO posting via `IDfoPostingStrategy` interface
- Implementations in `src/modules/queue/strategies/`

**Resilience Patterns**:
- Circuit breaker via `opossum` library
- Axios retry with exponential backoff
- Multi-layer caching (L1/L2/L3 with Redis + MongoDB fallback)

### D365FO Integration

Core services in `src/modules/d365fo/services/`:
- `d365fo-auth.service.ts` - OAuth2 token management
- `d365fo-client.service.ts` - HTTP client with circuit breaker, retry, caching
- `odata-query-builder.service.ts` - Fluent OData query construction
- Domain-specific services (vendor, customer, ledger, etc.)

### Queue Processing (BullMQ)

Queues defined in `src/modules/queue/constants/queues.ts`:
- `dfo-free-text-invoice-queue`
- `dfo-vendor-journal-queue`
- `dfo-ledger-journal-queue`
- `master-data-sync-queue`

Processors handle posting to D365FO with rollback support on failures.

### Configuration

Environment files: `.env.local`, `.env.development`, `.env.production`

Required environment variables (see `.env.example`):
- **App**: `PORT`, `PREFIX`, `ALLOWED_CORS_ORIGINS`
- **Database**: `MONGODB_URI`
- **Redis**: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (optional)
- **Auth**: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- **D365FO**: `D365FO_TENANT_ID`, `D365FO_CLIENT_ID`, `D365FO_CLIENT_SECRET`, `D365FO_RESOURCE`, `D365FO_AUTHORITY`
- **Resilience**: Circuit breaker and cache TTL settings

## Code Conventions

### TypeScript Path Aliases
Use `@/*` for imports from `src/`:
```typescript
import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { D365FOModule } from '@/modules/d365fo/d365fo.module';
```

### Import Order (enforced by ESLint)
1. Built-in modules
2. External packages
3. Internal modules (`@/...`)
4. Parent/sibling/index imports

### Naming Conventions
- Raw data models: `{EntryName}RawData` (e.g., `VendorFreightRawData`)
- DFO interfaces: `{EntryName}DFOLine`, `{EntryName}DFOHeader`
- Processors: `{EntryName}EntryProcessor`
- Commands: `Process{EntryName}Command`
- Handlers: `Process{EntryName}Handler`

### API Versioning
URI-based versioning (default: v1). Routes: `/api/v1/...`

### Swagger Documentation
Available at `/docs` endpoint.

## Adding New Features

### New Entry Processor
See `.docs/ADDING_NEW_MODULE_OR_PROCESSOR.md` for detailed steps:
1. Create raw data model in domain module
2. Create DFO data interface
3. Create processor extending `EntryProcessorBase`
4. Add to `EntryProcessorTypes` enum
5. Register in factory and module

### New Queue
1. Add queue name to `src/modules/queue/constants/queues.ts`
2. Create processor in `src/modules/queue/processors/`
3. Create strategy if needed in `src/modules/queue/strategies/`
4. Register queue in `queue.module.ts`

## External Documentation

See `.docs/` folder:
- `ADDING_NEW_MODULE_OR_PROCESSOR.md` - Complete guide for adding processors
- `D365FO_CONFIG.md` - Azure AD and D365FO authentication setup
- `BULLMQ_SETUP.md` - Queue configuration and usage
- `ODATA_QUERY_BUILDER.md` - OData query builder usage
- `ENV_VARIABLES.md` - Environment variable reference
