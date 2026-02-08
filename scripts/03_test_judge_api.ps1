# Test /api/judge endpoint with NDJSON streaming
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\03_test_judge_api.ps1

$ErrorActionPreference = "Stop"
$backend = "http://localhost:3000"

Write-Host "=== Testing /api/judge (NDJSON Stream) ===" -ForegroundColor Green
Write-Host ""

$body = @{
    prompt = "솔리드파워 추가매수? 내 현금 1억, 12개월, 손실 크게 못봄."
    mode = "base"
    debate = "none"
    provider_preference = $null
    stream = $true
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "$backend/api/judge?debug_user_id=test123" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 60

    Write-Host "Response Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Streaming Events:" -ForegroundColor Yellow
    Write-Host "---"
    
    $lines = $response.Content -split "`n" | Where-Object { $_.Trim() -ne "" }
    $eventCount = 0
    
    foreach ($line in $lines) {
        $eventCount++
        try {
            $event = $line | ConvertFrom-Json
            Write-Host "[$eventCount] $($event.type)" -ForegroundColor Cyan
            if ($event.type -eq "engine_result") {
                Write-Host "  Role: $($event.role)" -ForegroundColor Gray
            }
        } catch {
            Write-Host "[$eventCount] (parse error): $line" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host "Total events: $eventCount" -ForegroundColor Green
    
    # Check for required events
    $hasStart = ($lines | Where-Object { $_ -match '"type"\s*:\s*"start"' }).Count -gt 0
    $engineResults = ($lines | Where-Object { $_ -match '"type"\s*:\s*"engine_result"' }).Count
    
    Write-Host ""
    Write-Host "Validation:" -ForegroundColor Yellow
    Write-Host "  ✓ start event: $hasStart" -ForegroundColor $(if ($hasStart) {"Green"} else {"Red"})
    Write-Host "  ✓ engine_result count: $engineResults (expected: 4)" -ForegroundColor $(if ($engineResults -eq 4) {"Green"} else {"Red"})
    
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Red
    }
    exit 1
}

