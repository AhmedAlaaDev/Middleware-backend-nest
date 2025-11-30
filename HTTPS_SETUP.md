# HTTPS Setup Guide

This guide explains how to configure HTTPS for the MG D365FO Middleware application.

## Quick Start

### 1. Generate SSL Certificates

For development, you can generate self-signed certificates:

```powershell
.\scripts\generate-ssl-cert.ps1
```

This will create:
- `certs/key.pem` - Private key
- `certs/cert.pem` - Certificate

### 2. Configure Environment Variables

Add the following to your `.env.development` file:

```env
# HTTPS Configuration
HTTPS_ENABLED=true
HTTPS_KEY_PATH=certs/key.pem
HTTPS_CERT_PATH=certs/cert.pem
```

### 3. Restart the Application

```powershell
pnpm run start:dev
```

The application will now run on `https://localhost:3000`

## Production Setup

For production, use certificates from a trusted Certificate Authority (CA):

1. Obtain SSL certificates from a CA (Let's Encrypt, DigiCert, etc.)
2. Place the certificates in a secure location
3. Update environment variables:

```env
HTTPS_ENABLED=true
HTTPS_KEY_PATH=/path/to/your/private.key
HTTPS_CERT_PATH=/path/to/your/certificate.crt
```

## Using mkcert (Recommended for Local Development)

`mkcert` creates locally-trusted certificates that don't show browser warnings:

1. Install mkcert:
   ```powershell
   choco install mkcert
   # Or download from: https://github.com/FiloSottile/mkcert/releases
   ```

2. Install the local CA:
   ```powershell
   mkcert -install
   ```

3. Generate certificate:
   ```powershell
   mkcert localhost 127.0.0.1 ::1
   ```

4. This creates:
   - `localhost+2.pem` - Certificate
   - `localhost+2-key.pem` - Private key

5. Update `.env.development`:
   ```env
   HTTPS_ENABLED=true
   HTTPS_KEY_PATH=localhost+2-key.pem
   HTTPS_CERT_PATH=localhost+2.pem
   ```

## Troubleshooting

### Certificate Not Found

If you see warnings about certificates not being found:
- Verify the paths in your `.env.development` file
- Ensure the certificate files exist
- Check file permissions

### Browser Security Warning

Self-signed certificates will show a security warning in browsers:
- Click "Advanced" or "Show Details"
- Click "Proceed to localhost" or "Accept the Risk and Continue"

### Fallback to HTTP

If certificates are not found or invalid, the application will automatically fall back to HTTP. Check the console logs for details.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HTTPS_ENABLED` | Enable HTTPS | `false` |
| `HTTPS_KEY_PATH` | Path to private key file | `certs/key.pem` |
| `HTTPS_CERT_PATH` | Path to certificate file | `certs/cert.pem` |

## Security Notes

- **Development**: Self-signed certificates are acceptable
- **Production**: Always use certificates from a trusted CA
- **Never commit**: Certificate files are in `.gitignore` - never commit them to version control
- **File Permissions**: Ensure certificate files have appropriate permissions (read-only for the application user)

