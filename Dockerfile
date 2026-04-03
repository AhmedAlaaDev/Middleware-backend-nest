# Dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS dependencies
# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app
# Copy package files (workspace file required: lockfile overrides must match)
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
# Install dependencies
RUN pnpm install --frozen-lockfile --prefer-offline



# Stage 2: Build
FROM node:20-alpine AS build
# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app
# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules
# Copy source code
COPY . .
# Build the application
RUN pnpm run build



# Stage 3: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm (pin version for stable cache)
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

# Create non-root user early (needed for COPY --chown + writable dirs)
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

# Copy package files and install production deps once
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --prefer-offline

# Copy built application from build stage with correct ownership
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist

# ✅ Create writable temp dir for excel/zip exports (used by process.cwd()/temp)
RUN mkdir -p /app/temp && chown -R nestjs:nodejs /app/temp

# Switch to non-root user
USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/docs', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "dist/main.js"]



# Stage 4: Development (for hot reload)
FROM node:20-alpine AS development
# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app
# Copy package files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
# Install all dependencies (including dev dependencies)
RUN pnpm install --frozen-lockfile
# Copy source code
COPY . .
# Expose port
EXPOSE 3000
# Start in development mode with watch
# Use pnpm exec to ensure nest CLI is found from node_modules/.bin
CMD ["pnpm", "exec", "nest", "start", "--watch"]



