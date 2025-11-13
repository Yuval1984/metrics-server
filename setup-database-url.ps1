# PowerShell script to help set up DATABASE_URL
Write-Host "🔧 Setting up DATABASE_URL for PostgreSQL" -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (Test-Path .env) {
    Write-Host "⚠️  .env file already exists!" -ForegroundColor Yellow
    $overwrite = Read-Host "Do you want to add DATABASE_URL to it? (y/n)"
    if ($overwrite -ne "y") {
        Write-Host "Cancelled." -ForegroundColor Red
        exit
    }
} else {
    Write-Host "Creating new .env file..." -ForegroundColor Green
}

Write-Host ""
Write-Host "Where is your PostgreSQL database?" -ForegroundColor Cyan
Write-Host "1. Render.com (cloud)"
Write-Host "2. Local PostgreSQL"
Write-Host "3. Other (I'll provide the connection string)"
Write-Host ""
$choice = Read-Host "Enter choice (1-3)"

$databaseUrl = ""

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "📋 To get your DATABASE_URL from Render.com:" -ForegroundColor Yellow
        Write-Host "   1. Go to your Render dashboard"
        Write-Host "   2. Click on your PostgreSQL service"
        Write-Host "   3. Go to 'Connect' tab"
        Write-Host "   4. Copy the 'External Connection String'"
        Write-Host ""
        $databaseUrl = Read-Host "Paste your DATABASE_URL here"
    }
    "2" {
        Write-Host ""
        $host = Read-Host "Database host (default: localhost)"
        if ([string]::IsNullOrWhiteSpace($host)) { $host = "localhost" }
        
        $port = Read-Host "Port (default: 5432)"
        if ([string]::IsNullOrWhiteSpace($port)) { $port = "5432" }
        
        $database = Read-Host "Database name"
        $username = Read-Host "Username"
        $password = Read-Host "Password" -AsSecureString
        $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
        )
        
        $databaseUrl = "postgresql://${username}:${plainPassword}@${host}:${port}/${database}"
    }
    "3" {
        Write-Host ""
        $databaseUrl = Read-Host "Enter your full DATABASE_URL"
    }
    default {
        Write-Host "Invalid choice. Exiting." -ForegroundColor Red
        exit
    }
}

if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
    Write-Host "❌ DATABASE_URL cannot be empty!" -ForegroundColor Red
    exit
}

# Create or update .env file
$envContent = @"
# PostgreSQL Database Connection
DATABASE_URL=$databaseUrl

# Storage Type: "postgres" for PostgreSQL
STORAGE=postgres

# SSL for PostgreSQL (set to "require" for cloud providers like Render)
PGSSL=require

# API Keys (optional)
API_KEYS={}
"@

# If .env exists, read it and merge
if (Test-Path .env) {
    $existing = Get-Content .env -Raw
    # Check if DATABASE_URL already exists
    if ($existing -match "DATABASE_URL\s*=") {
        $envContent = $existing -replace "DATABASE_URL\s*=.*", "DATABASE_URL=$databaseUrl"
        Write-Host "✅ Updated existing DATABASE_URL in .env" -ForegroundColor Green
    } else {
        $envContent = $existing + "`n" + "DATABASE_URL=$databaseUrl`nSTORAGE=postgres`nPGSSL=require"
        Write-Host "✅ Added DATABASE_URL to existing .env" -ForegroundColor Green
    }
} else {
    Write-Host "✅ Created new .env file" -ForegroundColor Green
}

$envContent | Out-File -FilePath .env -Encoding utf8

Write-Host ""
Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Now you can test the connection with:" -ForegroundColor Cyan
Write-Host "  npm run check-db" -ForegroundColor Yellow
Write-Host ""

