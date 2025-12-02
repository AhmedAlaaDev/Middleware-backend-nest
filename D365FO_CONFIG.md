# D365FO Configuration Guide

This guide explains how to configure D365FO authentication in your NestJS application.

## Required Environment Variables

The following environment variables are required for D365FO authentication:

```env
# D365FO Authentication Configuration
D365FO_TENANT_ID=your-tenant-id
D365FO_CLIENT_ID=your-client-id
D365FO_CLIENT_SECRET=your-client-secret
D365FO_RESOURCE=https://your-d365fo-instance.com
D365FO_AUTHORITY=https://login.microsoftonline.com
```

## Configuration Details

### D365FO_TENANT_ID
Your Azure AD tenant ID (GUID format).

**Example:** `12345678-1234-1234-1234-123456789012`

### D365FO_CLIENT_ID
The Application (client) ID of your Azure AD app registration.

**Example:** `87654321-4321-4321-4321-210987654321`

### D365FO_CLIENT_SECRET
The client secret value from your Azure AD app registration.

**Example:** `abc123~XYZ789...`

### D365FO_RESOURCE
The D365FO instance URL (without trailing slash).

**Example:** `https://yourinstance.operations.dynamics.com`

### D365FO_AUTHORITY
The Azure AD authority endpoint (usually the same for all tenants).

**Example:** `https://login.microsoftonline.com`

## Setting Up in Docker

### Option 1: Using .env file (Recommended)

1. Create or update `.env.development` file in the project root:

```env
D365FO_TENANT_ID=your-tenant-id
D365FO_CLIENT_ID=your-client-id
D365FO_CLIENT_SECRET=your-client-secret
D365FO_RESOURCE=https://your-d365fo-instance.com
D365FO_AUTHORITY=https://login.microsoftonline.com
```

2. The docker-compose files will automatically load these variables.

### Option 2: Pass directly to docker-compose

```bash
D365FO_TENANT_ID=your-tenant-id \
D365FO_CLIENT_ID=your-client-id \
D365FO_CLIENT_SECRET=your-client-secret \
D365FO_RESOURCE=https://your-d365fo-instance.com \
D365FO_AUTHORITY=https://login.microsoftonline.com \
docker compose -f docker-compose.dev.yml up -d
```

### Option 3: Use docker-compose override file

Create `docker-compose.override.yml`:

```yaml
services:
  app:
    environment:
      D365FO_TENANT_ID: your-tenant-id
      D365FO_CLIENT_ID: your-client-id
      D365FO_CLIENT_SECRET: your-client-secret
      D365FO_RESOURCE: https://your-d365fo-instance.com
      D365FO_AUTHORITY: https://login.microsoftonline.com
```

## Verifying Configuration

After setting the environment variables, restart the container:

```bash
docker compose -f docker-compose.dev.yml restart app
```

Check if variables are loaded:

```bash
docker compose -f docker-compose.dev.yml exec app printenv | Select-String -Pattern "D365FO"
```

## Common Issues

### Error: "Invalid URL"
- **Cause:** Missing or empty `D365FO_AUTHORITY` or `D365FO_TENANT_ID`
- **Solution:** Ensure both variables are set correctly

### Error: "Failed to authenticate with D365FO"
- **Cause:** Invalid credentials or incorrect resource URL
- **Solution:** 
  1. Verify client ID and secret are correct
  2. Check that the resource URL matches your D365FO instance
  3. Ensure the Azure AD app has proper permissions

### Error: "Missing required D365FO configuration"
- **Cause:** One or more required environment variables are not set
- **Solution:** Check the error message for which variables are missing and set them

## Security Best Practices

1. **Never commit secrets to Git**
   - Add `.env.development` and `.env.production` to `.gitignore`
   - Use environment variables or secret management in production

2. **Use different credentials for different environments**
   - Development: `.env.development`
   - Production: `.env.production`

3. **Rotate secrets regularly**
   - Update client secrets in Azure AD
   - Update environment variables accordingly

4. **Use Azure Key Vault in production**
   - Store secrets in Azure Key Vault
   - Reference them in your deployment configuration

## Azure AD App Registration Setup

To get the required values, you need to:

1. **Register an application in Azure AD**
   - Go to Azure Portal → Azure Active Directory → App registrations
   - Click "New registration"
   - Set a name and click "Register"

2. **Get Tenant ID**
   - Found in the "Overview" page of your app registration

3. **Get Client ID**
   - Found in the "Overview" page (Application (client) ID)

4. **Create Client Secret**
   - Go to "Certificates & secrets"
   - Click "New client secret"
   - Copy the value immediately (it won't be shown again)

5. **Configure API Permissions**
   - Go to "API permissions"
   - Add permissions for Dynamics 365
   - Grant admin consent if required

## Testing the Configuration

Once configured, test the authentication:

```bash
# Check application logs
docker compose -f docker-compose.dev.yml logs app | Select-String -Pattern "D365FO"

# Try accessing a D365FO endpoint
curl http://localhost:3000/v1/Finance/MasterData/customer-list?company=mopp
```

If authentication is successful, you should see data returned instead of authentication errors.

