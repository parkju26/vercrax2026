# Test Integrity Hash and Supabase Persistence
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\04_test_integrity_supabase.ps1

$ErrorActionPreference = "Stop"
$backend = "http://localhost:3000"

Write-Host "=== Testing Integrity Hash & Supabase Persistence ===" -ForegroundColor Green
Write-Host ""

$body = @{
    prompt = "솔리드파워 추가매수? 내 현금 1억, 12개월, 손실 크게 못봄."
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

    Write-Host "Response Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Streaming Events:" -ForegroundColor Yellow
    Write-Host "---"
    
    $lines = $response.Content -split "`n" | Where-Object { $_.Trim() -ne "" }
    $eventCount = 0
    $events = @{}
    $decisionHash = $null
    $persistedEvent = $null
    
    foreach ($line in $lines) {
        $eventCount++
        try {
            $event = $line | ConvertFrom-Json
            $type = $event.type
            $events[$type] = ($events[$type] || 0) + 1
            
            Write-Host "[$eventCount] $type" -ForegroundColor Cyan
            
            if ($type -eq "final") {
                $decisionHash = $event.summary.decision_hash
                Write-Host "  Decision Hash: $decisionHash" -ForegroundColor Yellow
            }
            
            if ($type -eq "persisted") {
                $persistedEvent = $event
                Write-Host "  OK: $($event.ok)" -ForegroundColor $(if ($event.ok) {"Green"} else {"Red"})
                Write-Host "  Reason: $($event.reason)" -ForegroundColor Gray
                if ($event.judgmentSaved) {
                    Write-Host "  Judgment Saved: YES" -ForegroundColor Green
                }
                if ($event.stepsSaved -gt 0) {
                    Write-Host "  Steps Saved: $($event.stepsSaved)" -ForegroundColor Green
                }
                if ($event.error) {
                    Write-Host "  Error: $($event.error)" -ForegroundColor Red
                }
            }
        } catch {
            Write-Host "[$eventCount] Parse error: $($line.Substring(0, [Math]::Min(100, $line.Length)))" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host "=== Summary ===" -ForegroundColor Green
    Write-Host "Total events: $eventCount"
    Write-Host "Event types:"
    foreach ($key in $events.Keys | Sort-Object) {
        Write-Host "  $key : $($events[$key])" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "=== Validation ===" -ForegroundColor Yellow
    
    # Check decision_hash
    if ($decisionHash) {
        Write-Host "✓ decision_hash generated: $($decisionHash.Substring(0, 16))..." -ForegroundColor Green
    } else {
        Write-Host "✗ decision_hash missing" -ForegroundColor Red
    }
    
    # Check persisted event
    if ($persistedEvent) {
        Write-Host "✓ persisted event emitted" -ForegroundColor Green
        if ($persistedEvent.ok) {
            Write-Host "  ✓ Persistence successful" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ Persistence failed but streaming continued" -ForegroundColor Yellow
            Write-Host "    Reason: $($persistedEvent.reason)" -ForegroundColor Gray
        }
    } else {
        Write-Host "✗ persisted event missing" -ForegroundColor Red
    }
    
    # Check that final event came after persisted (streaming continued)
    $finalIndex = -1
    $persistedIndex = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        try {
            $evt = $lines[$i] | ConvertFrom-Json
            if ($evt.type -eq "final") { $finalIndex = $i }
            if ($evt.type -eq "persisted") { $persistedIndex = $i }
        } catch {}
    }
    
    if ($finalIndex -ge 0 -and $persistedIndex -ge 0) {
        if ($persistedIndex -gt $finalIndex) {
            Write-Host "✓ Streaming continued after final event" -ForegroundColor Green
            Write-Host "  Final at index $finalIndex, Persisted at index $persistedIndex" -ForegroundColor Gray
        } else {
            Write-Host "⚠ Persisted came before final (expected after)" -ForegroundColor Yellow
        }
    }
    
    # Check that all required events are present
    $requiredEvents = @("start", "engine_result", "base_judgment", "debate_final", "final", "persisted")
    $missingEvents = $requiredEvents | Where-Object { -not $events.ContainsKey($_) }
    
    if ($missingEvents.Count -eq 0) {
        Write-Host "✓ All required events present" -ForegroundColor Green
    } else {
        Write-Host "✗ Missing events: $($missingEvents -join ', ')" -ForegroundColor Red
    }
    
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Red
    }
    exit 1
}
