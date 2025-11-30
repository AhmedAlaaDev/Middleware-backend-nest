# Migration to pnpm

This project now uses **pnpm** as the package manager instead of npm.

## Changes Made

### 1. Package Configuration
- **File**: `package.json`
- **Added**: `packageManager` field specifying pnpm version
- All existing scripts remain unchanged and work with pnpm

### 2. pnpm Configuration
- **File**: `.npmrc`
- **Settings**:
  - `auto-install-peers=true` - Automatically install peer dependencies
  - `strict-peer-dependencies=false` - Relaxed peer dependency checks
  - `shamefully-hoist=false` - Use pnpm's strict dependency resolution

### 3. Documentation Updates
All documentation files have been updated to use `pnpm` instead of `npm`:
- `README.md`
- `QUICK_START.md`
- `PRISMA_MIGRATION.md`

## Installing pnpm

If you don't have pnpm installed yet:

### Option 1: Using npm (one-time)
```bash
npm install -g pnpm
```

### Option 2: Using Homebrew (macOS/Linux)
```bash
brew install pnpm
```

### Option 3: Using PowerShell (Windows)
```powershell
iwr https://get.pnpm.io/install.ps1 -useb | iex
```

### Option 4: Using npm exec (no global install)
```bash
npx pnpm@latest install
```

## Usage

All commands remain the same, just replace `npm` with `pnpm`:

```bash
# Install dependencies
pnpm install

# Run scripts
pnpm run start:dev
pnpm run build
pnpm run test

# Add dependencies
pnpm add package-name
pnpm add -D dev-package-name

# Remove dependencies
pnpm remove package-name
```

## Benefits of pnpm

1. **Disk Space Efficiency**: Uses hard links and symlinks, saving disk space
2. **Faster Installs**: Faster than npm in most scenarios
3. **Strict Dependency Resolution**: Prevents phantom dependencies
4. **Better Monorepo Support**: Excellent for monorepo setups
5. **Compatible with npm**: Most npm commands work with pnpm

## Migration Notes

- Existing `package-lock.json` files can be removed (pnpm uses `pnpm-lock.yaml`)
- The project will automatically use pnpm when you run commands (via `packageManager` field)
- If you prefer to keep using npm, you can still do so, but pnpm is recommended

## Next Steps

1. Install pnpm (if not already installed)
2. Remove `package-lock.json` if it exists:
   ```bash
   rm package-lock.json
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Continue using pnpm for all package management tasks

