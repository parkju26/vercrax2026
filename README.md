# Vercrax (Rebuild Starter)

이 zip은 **처음부터 다시 시작하는 Vercrax v0.1 스타터**입니다.
- Backend: Express (NDJSON streaming)
- Frontend: Next.js (Chat + Arena timeline)
- Supabase: schema.sql 포함

## 빠른 시작 (Windows / PowerShell)
1) 압축을 D:\AGENT\VERCRAX\ 에 풀기
2) Backend
```powershell
cd D:\AGENT\VERCRAXackend
copy .env.example .env
npm i
npm run dev
```

3) Frontend
```powershell
cd D:\AGENT\VERCRAXrontend
npm i
npm run dev
```

- Backend: http://localhost:3000
- Frontend: http://localhost:3001

## Supabase
- backend/supabase/schema.sql 을 Supabase SQL Editor에서 실행
- backend/.env 에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 설정
