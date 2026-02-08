# Test that streaming continues even when Supabase save fails
# This test intentionally uses invalid Supabase credentials to verify error handling

$ErrorActionPreference = "Stop"
$backend = "http://localhost:3000"

Write-Host "=== Testing Streaming Continuity on Supabase Failure ===" -ForegroundColor Green
Write-Host ""

$body = @{
    prompt = "테스트: Supabase 저장 실패 시 스트리밍 유지 확인"
    mode = "base"
    debate = "arena"
    stream = $true
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "$backend/api/judge?debug_user_id=test123" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 120

    $lines = $response.Content -split "`n" | Where-Object { $_.Trim() -ne "" }
    
    $eventSequence = @()
    $hasFinal = $false
    $hasPersisted = $false
    $persistedAfterFinal = $false
    
    foreach ($line in $lines) {
        try {
            $event = $line | ConvertFrom-Json
            $eventSequence += $event.type
            
            if ($event.type -eq "final") {
                $hasFinal = $true
                Write-Host "✓ final event received" -ForegroundColor Green
            }
            
            if ($event.type -eq "persisted") {
                $hasPersisted = $true
                if ($hasFinal) {
                    $persistedAfterFinal = $true
                }
                Write-Host "✓ persisted event received (OK: $($event.ok))" -ForegroundColor $(if ($event.ok) {"Green"} else {"Yellow"})
                if (-not $event.ok) {
                    Write-Host "  Reason: $($event.reason)" -ForegroundColor Gray
                }
            }
        } catch {}
    }
    
    Write-Host ""
    Write-Host "=== Test Results ===" -ForegroundColor Yellow
    
    if ($hasFinal -and $hasPersisted) {
        Write-Host "✓ PASS: Both final and persisted events received" -ForegroundColor Green
        if ($persistedAfterFinal) {
            Write-Host "✓ PASS: persisted came after final (streaming continued)" -ForegroundColor Green
        } else {
            Write-Host "⚠ WARN: persisted came before final" -ForegroundColor Yellow
        }
    } else {
        Write-Host "✗ FAIL: Missing events" -ForegroundColor Red
        Write-Host "  final: $hasFinal, persisted: $hasPersisted" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "Event sequence: $($eventSequence -join ' → ')" -ForegroundColor Gray
    
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

