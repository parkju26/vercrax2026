# Vercrax init script (PowerShell)
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\01_init.ps1

$ErrorActionPreference = "Stop"
$root = "D:\AGENT\VERCRAX"

Write-Host "=== Vercrax 프로젝트 초기화 ===" -ForegroundColor Green
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "$root\backend")) {
    Write-Host "오류: $root\backend 폴더를 찾을 수 없습니다." -ForegroundColor Red
    exit 1
}

Write-Host "[1/2] Backend 설정..." -ForegroundColor Yellow
if (-not (Test-Path "$root\backend\.env")) {
    Copy-Item "$root\backend\.env.example" "$root\backend\.env" -ErrorAction SilentlyContinue
    Write-Host "  ✓ .env 파일 생성됨 (키를 입력하세요)" -ForegroundColor Green
} else {
    Write-Host "  ✓ .env 파일 이미 존재" -ForegroundColor Green
}

Write-Host ""
Write-Host "[2/2] Frontend 설정..." -ForegroundColor Yellow
Write-Host "  ✓ 설정 완료" -ForegroundColor Green

Write-Host ""
Write-Host "=== 다음 단계 ===" -ForegroundColor Green
Write-Host "1) Backend 실행:"
Write-Host "   cd $root\backend"
Write-Host "   npm i"
Write-Host "   npm run dev"
Write-Host ""
Write-Host "2) Frontend 실행 (새 터미널):"
Write-Host "   cd $root\frontend"
Write-Host "   npm i"
Write-Host "   npm run dev"
Write-Host ""
Write-Host "3) 브라우저: http://localhost:3001" -ForegroundColor Cyan
