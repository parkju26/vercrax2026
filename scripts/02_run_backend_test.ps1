# Backend health check test
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\02_run_backend_test.ps1

$ErrorActionPreference = "Stop"
$backend = "http://localhost:3000"

Write-Host "=== Backend Health Check ===" -ForegroundColor Green
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "$backend/health" -Method GET -TimeoutSec 5
    Write-Host "✓ Health OK: $($response | ConvertTo-Json)" -ForegroundColor Green
} catch {
    Write-Host "✗ Backend가 실행 중이 아닙니다. 'npm run dev'를 실행하세요." -ForegroundColor Red
    Write-Host "  오류: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Backend 정상 동작 중!" -ForegroundColor Green
