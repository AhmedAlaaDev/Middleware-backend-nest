# Docker Setup Guide

This guide explains how to build and run the D365FO Middleware application using Docker.

## Prerequisites

- Docker Engine 20.10+ or Docker Desktop
- Docker Compose 2.0+

## Quick Start

### Production Mode

Build and run the application in production mode:

```bash
# Build and start all services
docker compose up -d

# View logs
docker compose logs -f app

# Stop all services
docker compose down
```

### Development Mode

Run the application in development mode with hot reload:

```bash
# Build and start all services in development mode
docker compose -f docker-compose.dev.yml up -d

# View logs
docker compose -f docker-compose.dev.yml logs -f app

# Stop all services
docker compose -f docker-compose.dev.yml down
```

## Services

The Docker setup includes the following services:

1. **app** - NestJS application (port 3000)
2. **mongodb** - MongoDB database (port 27017)
3. **redis** - Redis cache/queue backend (port 6379)

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Application
PORT=3000
NODE_ENV=production
PREFIX=
ALLOWED_CORS_ORIGINS=http://localhost:3000

# Database
MONGODB_URI=mongodb://root:sp3awi@mongodb:27017/d365fo?authSource=admin

# MongoDB (for docker-compose)
MONGO_INITDB_ROOT_USERNAME=root
MONGO_INITDB_ROOT_PASSWORD=sp3awi
```

## Building the Docker Image

### Build for Production

```bash
docker build -t d365fo-middleware:latest .
```

### Build for Development

```bash
docker build --target development -t d365fo-middleware:dev .
```

## Docker Compose Commands

### Production

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# View logs
docker compose logs -f

# Rebuild and restart
docker compose up -d --build

# Remove volumes (clean database)
docker compose down -v
```

### Development

```bash
# Start services
docker compose -f docker-compose.dev.yml up -d

# Stop services
docker compose -f docker-compose.dev.yml down

# View logs
docker compose -f docker-compose.dev.yml logs -f

# Rebuild and restart
docker compose -f docker-compose.dev.yml up -d --build
```

## Accessing Services

- **Application**: http://localhost:3000
- **API Documentation**: http://localhost:3000/docs
- **MongoDB**: mongodb://localhost:27017

## Dockerfile Stages

The Dockerfile uses a multi-stage build with the following stages:

1. **dependencies** - Installs all npm dependencies
2. **build** - Builds the TypeScript application
3. **development** - Development environment with hot reload
4. **production** - Optimized production image with only production dependencies

## Troubleshooting

### Port Already in Use

If port 3000 is already in use, change it in your `.env` file:

```env
PORT=3001
```

### MongoDB Connection Issues

Ensure MongoDB is healthy before the app starts:

```bash
docker compose ps
```

Check MongoDB logs:

```bash
docker compose logs mongodb
```

### Rebuild After Dependency Changes

If you've updated `package.json`, rebuild the image:

```bash
docker compose build --no-cache app
docker compose up -d
```

### View Container Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f app

# Last 100 lines
docker compose logs --tail=100 app
```

### Execute Commands in Container

```bash
# Access app container shell
docker compose exec app sh

# Run pnpm commands
docker compose exec app pnpm install

# Access MongoDB shell
docker compose exec mongodb mongosh -u root -p sp3awi
```

## Production Deployment

For production deployment, consider:

1. **Use environment-specific configuration** - Set `NODE_ENV=production`
2. **Use secrets management** - Don't hardcode passwords in docker-compose.yml
3. **Enable health checks** - Already configured in the Dockerfile
4. **Use reverse proxy** - Nginx or Traefik for SSL termination
5. **Set resource limits** - Add memory and CPU limits in docker-compose.yml
6. **Use Docker secrets** - For sensitive data in production

### Example Production docker-compose.yml

```yaml
services:
  app:
    # ... existing config ...
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
    restart: always
```

## CI/CD Integration

The Docker setup is ready for CI/CD pipelines. Example GitHub Actions:

```yaml
- name: Build Docker image
  run: docker build -t d365fo-middleware:${{ github.sha }} .

- name: Run tests in container
  run: docker run --rm d365fo-middleware:${{ github.sha }} pnpm test
```

## Volume Management

### Backup MongoDB Data

```bash
docker compose exec mongodb mongodump --out /data/backup --username root --password sp3awi --authenticationDatabase admin
```

### Restore MongoDB Data

```bash
docker compose exec mongodb mongorestore /data/backup --username root --password sp3awi --authenticationDatabase admin
```

## Security Considerations

1. **Change default passwords** - Update MongoDB credentials
2. **Use secrets** - Don't commit `.env` files
3. **Network isolation** - Services communicate via Docker network
4. **Non-root user** - Application runs as non-root user in container
5. **Regular updates** - Keep base images updated

