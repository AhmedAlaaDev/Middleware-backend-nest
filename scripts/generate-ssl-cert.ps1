# Generate Self-Signed SSL Certificate for Development
# This script generates a self-signed certificate for HTTPS development

Write-Host "=== Generating Self-Signed SSL Certificate ===" -ForegroundColor Cyan
Write-Host ""

# Create certs directory if it doesn't exist
$certsDir = "certs"
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir | Out-Null
    Write-Host "✓ Created certs directory" -ForegroundColor Green
}

# Check if OpenSSL is available
$opensslPath = Get-Command openssl -ErrorAction SilentlyContinue

if (-not $opensslPath) {
    Write-Host "ERROR: OpenSSL is not installed or not in PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install OpenSSL:" -ForegroundColor Yellow
    Write-Host "1. Download from: https://slproweb.com/products/Win32OpenSSL.html" -ForegroundColor Cyan
    Write-Host "2. Or use Chocolatey: choco install openssl" -ForegroundColor Cyan
    Write-Host "3. Or use Git Bash (includes OpenSSL)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Alternative: Use mkcert for trusted local certificates:" -ForegroundColor Yellow
    Write-Host "  choco install mkcert" -ForegroundColor Cyan
    Write-Host "  mkcert -install" -ForegroundColor Cyan
    Write-Host "  mkcert localhost 127.0.0.1 ::1" -ForegroundColor Cyan
    exit 1
}

Write-Host "Generating private key..." -ForegroundColor Yellow
openssl genrsa -out "$certsDir/key.pem" 2048

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to generate private key" -ForegroundColor Red
    exit 1
}

Write-Host "Generating certificate signing request..." -ForegroundColor Yellow
openssl req -new -key "$certsDir/key.pem" -out "$certsDir/csr.pem" -subj "/CN=localhost/C=US/ST=State/L=City/O=Organization"

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to generate CSR" -ForegroundColor Red
    exit 1
}

Write-Host "Generating self-signed certificate (valid for 365 days)..." -ForegroundColor Yellow
openssl x509 -req -days 365 -in "$certsDir/csr.pem" -signkey "$certsDir/key.pem" -out "$certsDir/cert.pem"

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to generate certificate" -ForegroundColor Red
    exit 1
}

# Clean up CSR file
Remove-Item "$certsDir/csr.pem" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "✓ SSL Certificate generated successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Certificate files:" -ForegroundColor Cyan
Write-Host "  - Private Key: $certsDir/key.pem" -ForegroundColor White
Write-Host "  - Certificate: $certsDir/cert.pem" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  WARNING: This is a self-signed certificate for development only!" -ForegroundColor Yellow
Write-Host "   Browsers will show a security warning. Click 'Advanced' and 'Proceed' to continue." -ForegroundColor Yellow
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Add to .env.development:" -ForegroundColor Yellow
Write-Host "   HTTPS_ENABLED=true" -ForegroundColor White
Write-Host "   HTTPS_KEY_PATH=certs/key.pem" -ForegroundColor White
Write-Host "   HTTPS_CERT_PATH=certs/cert.pem" -ForegroundColor White
Write-Host ""
Write-Host "2. Restart the application" -ForegroundColor Yellow
Write-Host ""

