# Vercrax Backend (Express)

## 1) Setup
```bash
cd backend
copy .env.example .env
npm i
npm run dev
```

## 2) Test (PowerShell)
```powershell
$debug="d296c55f-beea-429e-ac58-5f12a19d12b3"
$body = @{
  prompt = "솔리드파워 추가매수 판단. 내 현금 1억, 12개월, 리스크는 크게 못짐."
  mode = "deep"
  debate = "arena"
  provider_preference = "openai"
  stream = $true
} | ConvertTo-Json -Depth 10

irm "http://localhost:3000/api/judge?debug_user_id=$debug" -Method Post -ContentType "application/json" -Body $body
```

## 3) Streaming format
NDJSON lines:
- start
- engine_result (x4)
- base_judgment
- deep_judgment (optional)
- debate_step (many)
- debate_final
- final
- persisted
