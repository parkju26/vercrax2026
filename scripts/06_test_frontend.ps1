# Test Frontend functionality
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\06_test_frontend.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== Frontend 테스트 가이드 ===" -ForegroundColor Green
Write-Host ""

Write-Host "1. Backend 서버 실행 확인:" -ForegroundColor Yellow
Write-Host "   cd D:\AGENT\VERCRAX\backend"
Write-Host "   npm run dev"
Write-Host "   → http://localhost:3000/health 에서 확인" -ForegroundColor Gray
Write-Host ""

Write-Host "2. Frontend 서버 실행:" -ForegroundColor Yellow
Write-Host "   cd D:\AGENT\VERCRAX\frontend"
Write-Host "   npm run dev"
Write-Host "   → http://localhost:3001 에서 확인" -ForegroundColor Gray
Write-Host ""

Write-Host "3. 브라우저에서 테스트:" -ForegroundColor Yellow
Write-Host "   - 좌측 채팅창에 질문 입력" -ForegroundColor Gray
Write-Host "   - 우측 타임라인에서 실시간 이벤트 확인" -ForegroundColor Gray
Write-Host "   - Stop 버튼으로 중단 테스트" -ForegroundColor Gray
Write-Host "   - 에러 발생 시 무한 로딩 없이 종료 메시지 확인" -ForegroundColor Gray
Write-Host ""

Write-Host "4. 확인 사항:" -ForegroundColor Yellow
Write-Host "   ✓ NDJSON 스트리밍으로 이벤트 실시간 표시" -ForegroundColor Green
Write-Host "   ✓ Stop 버튼으로 AbortController 동작" -ForegroundColor Green
Write-Host "   ✓ Abort/에러 시 무한 로딩 없이 종료 메시지 표시" -ForegroundColor Green
Write-Host "   ✓ 우측 타임라인에 debate_step, engine_result 등 표시" -ForegroundColor Green
Write-Host "   ✓ BASE, Winner, Persistence, Decision Hash 표시" -ForegroundColor Green
Write-Host ""

Write-Host "Backend health check:" -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/health" -Method GET -TimeoutSec 2
    Write-Host "  ✓ Backend 정상: $($health | ConvertTo-Json)" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Backend 미실행 또는 오류: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    → Backend를 먼저 실행하세요" -ForegroundColor Yellow
}

