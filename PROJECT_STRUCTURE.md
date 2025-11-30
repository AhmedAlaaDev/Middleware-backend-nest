# Complete NestJS Project Structure

This document outlines the complete project structure with all modules and their responsibilities.

## 📁 Full Directory Structure

```
MGD365Middleware.Host.NestJS/
├── src/
│   ├── main.ts                          # Application entry point
│   ├── app.module.ts                    # Root module
│   │
│   ├── config/                          # Configuration
│   │   ├── configuration.ts            # Config mapping
│   │   └── validation.schema.ts        # Environment validation
│   │
│   ├── common/                          # Shared utilities
│   │   ├── common.module.ts
│   │   ├── dto/                        # Common DTOs
│   │   │   ├── paginated-result.dto.ts
│   │   │   └── operation-result.dto.ts
│   │   ├── filters/                    # Exception filters
│   │   │   └── all-exceptions.filter.ts
│   │   ├── interceptors/               # Request/Response interceptors
│   │   │   ├── logging.interceptor.ts
│   │   │   └── transform.interceptor.ts
│   │   ├── guards/                     # Auth guards
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   ├── decorators/                 # Custom decorators
│   │   │   ├── roles.decorator.ts
│   │   │   └── current-user.decorator.ts
│   │   ├── logger/                     # Winston logger
│   │   │   └── winston-logger.service.ts
│   │   └── resilience/                 # Resilience patterns
│   │       ├── circuit-breaker.service.ts
│   │       └── retry.service.ts
│   │
│   └── modules/                         # Feature modules
│       ├── cache/                      # ✅ Multi-layer caching
│       │   ├── cache.module.ts
│       │   └── services/
│       │       ├── cache.service.ts
│       │       └── multi-layer-cache.service.ts
│       │
│       ├── database/                   # Database utilities
│       │   ├── database.module.ts
│       │   ├── entities/               # TypeORM entities
│       │   └── migrations/             # Database migrations
│       │
│       ├── auth/                       # Authentication
│       │   ├── auth.module.ts
│       │   ├── controllers/
│       │   ├── services/
│       │   │   ├── auth.service.ts
│       │   │   └── jwt.service.ts
│       │   └── strategies/
│       │       └── jwt.strategy.ts
│       │
│       ├── users/                      # User management
│       │   ├── users.module.ts
│       │   ├── controllers/
│       │   ├── services/
│       │   ├── entities/
│       │   └── dto/
│       │
│       ├── master-data/                # ✅ Optimized master data
│       │   ├── master-data.module.ts
│       │   ├── services/
│       │   │   └── master-data.service.ts  # Preloaded, cached
│       │   ├── entities/
│       │   └── dto/
│       │
│       ├── data-batches/               # Batch management
│       │   ├── data-batches.module.ts
│       │   ├── controllers/
│       │   ├── commands/               # CQRS Commands
│       │   ├── queries/                # CQRS Queries
│       │   ├── handlers/               # CQRS Handlers
│       │   ├── services/
│       │   │   └── data-batch.service.ts
│       │   └── schemas/                # MongoDB schemas
│       │       ├── data-batch.schema.ts
│       │       ├── data-source-record.schema.ts
│       │       ├── data-enhanced-record.schema.ts
│       │       └── data-batch-error.schema.ts
│       │
│       ├── account-receivable/         # AR processing
│       │   ├── account-receivable.module.ts
│       │   ├── controllers/
│       │   ├── commands/
│       │   ├── handlers/
│       │   └── dto/
│       │
│       ├── ledger/                     # Ledger entries
│       │   ├── ledger.module.ts
│       │   ├── controllers/
│       │   ├── commands/
│       │   └── handlers/
│       │
│       ├── d365fo/                     # ✅ D365FO integration (Resilient)
│       │   ├── d365fo.module.ts
│       │   ├── services/
│       │   │   ├── d365fo-auth.service.ts    # Token caching
│       │   │   └── d365fo-data.service.ts    # Circuit breaker, retry
│       │   └── dto/
│       │
│       ├── entry-processors/           # ✅ Entry processors (Factory)
│       │   ├── entry-processors.module.ts
│       │   ├── services/
│       │   │   ├── entry-processor.factory.ts
│       │   │   └── base/
│       │   │       └── entry-processor.base.ts
│       │   ├── processors/
│       │   │   ├── account-receivable/
│       │   │   ├── ledger/
│       │   │   └── ...
│       │   └── interfaces/
│       │
│       └── health/                     # Health checks
│           ├── health.module.ts
│           └── controllers/
│               └── health.controller.ts
│
├── test/                               # E2E tests
├── logs/                               # Log files
├── package.json
├── tsconfig.json
├── nest-cli.json
├── .env.example
├── README.md
└── PROJECT_STRUCTURE.md
```

## 🎯 Module Responsibilities

### Core Modules

1. **Cache Module** ✅
   - Multi-layer caching (L1/L2/L3)
   - Cache warming
   - Cache invalidation

2. **Master Data Module** ✅
   - Preloaded master data
   - Cached lookups
   - Bulk loading

3. **D365FO Module** ✅
   - OAuth authentication (token caching)
   - OData API calls (circuit breaker, retry)
   - Resilient error handling

4. **Entry Processors Module** ✅
   - Factory pattern for processors
   - Base processor class
   - 16 different processor types

5. **Data Batches Module**
   - Batch CRUD operations
   - CQRS pattern
   - MongoDB operations

### Supporting Modules

6. **Auth Module**
   - JWT authentication
   - Role-based authorization

7. **Users Module**
   - User management
   - PostgreSQL integration

8. **Health Module**
   - Health checks
   - Database connectivity
   - External service status

## 🔄 Data Flow (Improved)

```
Excel Upload
    ↓
Controller (Rate Limited)
    ↓
CQRS Command
    ↓
Handler
    ↓
Entry Processor Factory
    ↓
Entry Processor
    ├─→ Master Data Service (Cached)
    ├─→ Cache Service (Multi-layer)
    └─→ Validation
    ↓
Data Batch Service (Unit of Work)
    ├─→ MongoDB (Bulk Insert)
    └─→ Cache Update
    ↓
Background Job (Bull Queue)
    ↓
Entry Processor (Post to D365FO)
    ├─→ Circuit Breaker
    ├─→ Retry Policy
    └─→ D365FO Service
```

## 📊 Improvements Implemented

### ✅ Caching
- Multi-layer cache service
- Automatic fallback
- Cache warming on startup
- Smart invalidation

### ✅ Resilience
- Circuit breaker for D365FO
- Retry with exponential backoff
- Timeout handling
- Graceful degradation

### ✅ Performance
- Parallel processing
- Bulk operations
- Compiled queries (TypeORM)
- Connection pooling

### ✅ Architecture
- CQRS pattern
- Factory pattern
- Dependency injection
- Clean separation

## 🚀 Next Steps

1. Complete remaining modules (following patterns)
2. Implement all 16 entry processors
3. Add comprehensive tests
4. Set up CI/CD
5. Performance benchmarking

---

**Status**: Core infrastructure complete ✅ | Domain modules in progress ⏳

