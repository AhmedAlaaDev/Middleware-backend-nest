# Environment Variables Reference

This document lists all environment variables used in the application and their default values.

## Application Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Node environment (development/production/test) |
| `PORT` | `3000` | Application port |
| `PREFIX` | `` | API prefix (empty by default) |
| `ALLOWED_CORS_ORIGINS` | `*` (dev) / `` (prod) | Comma-separated list of allowed CORS origins |

## Database Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_URI` | `mongodb://root:sp3awi@mongodb:27017/d365fo?authSource=admin` | MongoDB connection string |
| `MONGODB_MAX_POOL_SIZE` | `5` | Maximum MongoDB connection pool size |

## Redis Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `redis` (Docker) / `localhost` (local) | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | `` | Redis password (optional) |
| `REDIS_DB` | `0` | Redis database number |
| `REDIS_MAX_RETRIES_PER_REQUEST` | `3` | Maximum retries per request |
| `REDIS_ENABLE_READY_CHECK` | `true` | Enable Redis ready check |
| `REDIS_LAZY_CONNECT` | `false` | Lazy connect to Redis |

## Authentication Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `` | JWT secret key (required) |
| `JWT_EXPIRES_IN` | `15d` | JWT expiration time |
| `JWT_AUDIENCE` | `mg-d365fo-middleware` | JWT audience |
| `JWT_ISSUER` | `mg-d365fo-middleware` | JWT issuer |

## D365FO Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `D365FO_TENANT_ID` | `` | Azure AD tenant ID (required) |
| `D365FO_CLIENT_ID` | `` | Azure AD client ID (required) |
| `D365FO_CLIENT_SECRET` | `` | Azure AD client secret (required) |
| `D365FO_RESOURCE` | `` | D365FO instance URL (required) |
| `D365FO_AUTHORITY` | `` | Azure AD authority URL (required) |

## Resilience Configuration

### Circuit Breaker

| Variable | Default | Description |
|----------|---------|-------------|
| `CIRCUIT_BREAKER_TIMEOUT` | `30000` | Circuit breaker timeout in milliseconds |
| `CIRCUIT_BREAKER_RESET_TIMEOUT` | `30000` | Circuit breaker reset timeout in milliseconds |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5` | Number of failures before opening circuit |
| `CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENTAGE` | `50` | Error percentage threshold |
| `CIRCUIT_BREAKER_ENABLED` | `true` | Enable/disable circuit breaker |

### Cache

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_L1_TTL` | `5` | L1 cache TTL in minutes |
| `CACHE_L2_TTL` | `30` | L2 cache TTL in minutes |
| `CACHE_L3_TTL` | `120` | L3 cache TTL in minutes |
| `REDIS_ENABLED` | `false` | Enable Redis for caching |

## Example .env.development File

```env
# Application
NODE_ENV=development
PORT=3000
PREFIX=
ALLOWED_CORS_ORIGINS=http://localhost:3000,http://localhost:4200

# Database
MONGODB_URI=mongodb://root:sp3awi@mongodb:27017/d365fo?authSource=admin
MONGODB_MAX_POOL_SIZE=5

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_MAX_RETRIES_PER_REQUEST=3
REDIS_ENABLE_READY_CHECK=true
REDIS_LAZY_CONNECT=false

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=15d
JWT_AUDIENCE=mg-d365fo-middleware
JWT_ISSUER=mg-d365fo-middleware

# D365FO
D365FO_TENANT_ID=your-tenant-id
D365FO_CLIENT_ID=your-client-id
D365FO_CLIENT_SECRET=your-client-secret
D365FO_RESOURCE=https://yourinstance.operations.dynamics.com
D365FO_AUTHORITY=https://login.microsoftonline.com

# Resilience - Circuit Breaker
CIRCUIT_BREAKER_TIMEOUT=30000
CIRCUIT_BREAKER_RESET_TIMEOUT=30000
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENTAGE=50
CIRCUIT_BREAKER_ENABLED=true

# Resilience - Cache
CACHE_L1_TTL=5
CACHE_L2_TTL=30
CACHE_L3_TTL=120
REDIS_ENABLED=false
```

## Required Variables

The following variables are **required** and must be set:

- `JWT_SECRET` - For JWT token generation
- `D365FO_TENANT_ID` - For D365FO authentication
- `D365FO_CLIENT_ID` - For D365FO authentication
- `D365FO_CLIENT_SECRET` - For D365FO authentication
- `D365FO_RESOURCE` - For D365FO API calls
- `D365FO_AUTHORITY` - For D365FO authentication

All other variables have defaults and are optional.

## Docker Environment Variables

All environment variables are automatically passed to the Docker container through the `docker-compose.yml` and `docker-compose.dev.yml` files. They can be set via:

1. `.env` file in the project root
2. `.env.development` or `.env.production` files
3. Environment variables in the shell
4. Docker secrets (for production)

## Verifying Environment Variables in Docker

To check which environment variables are set in a running container:

```bash
# View all environment variables
docker compose -f docker-compose.dev.yml exec app printenv

# View specific variables
docker compose -f docker-compose.dev.yml exec app printenv | Select-String -Pattern "D365FO"
docker compose -f docker-compose.dev.yml exec app printenv | Select-String -Pattern "JWT"
```

