// Test /api/judge streaming
// Uses native fetch (Node.js 18+)

const BACKEND = 'http://localhost:3000';
// Use arena mode for testing debate
const body = {
  prompt: '솔리드파워 추가매수? 내 현금 1억, 12개월, 손실 크게 못봄.',
  mode: 'base',
  debate: 'arena',
  stream: true
};

console.log('=== Testing /api/judge (NDJSON Stream) ===\n');

try {
  const response = await fetch(`${BACKEND}/api/judge?debug_user_id=test123`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000) // 120초 타임아웃
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let eventCount = 0;
  const events = {};

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const event = JSON.parse(line);
        eventCount++;
        const type = event.type;
        events[type] = (events[type] || 0) + 1;
        
        console.log(`[${eventCount}] ${type}`);
        if (type === 'engine_result') {
          console.log(`  Role: ${event.role}, Provider: ${event.provider}`);
        }
        if (type === 'base_judgment') {
          console.log(`  Label: ${event.base?.label}, Confidence: ${event.base?.confidence}`);
          if (event.base?.engine_disagreements) {
            console.log(`  Disagreements: ${event.base.engine_disagreements.length} items`);
          } else {
            console.log(`  ⚠️  engine_disagreements missing!`);
          }
        }
        if (type === 'debate_step') {
          console.log(`  Round ${event.round}, Phase: ${event.phase}, ${event.challenger} → ${event.defender}`);
          if (event.phase === 'judge' && event.payload?.score) {
            console.log(`  Score: ${JSON.stringify(event.payload.score)}`);
          }
        }
        if (type === 'debate_final') {
          console.log(`  Winner: ${event.winner}, Score: ${JSON.stringify(event.score)}`);
          if (event.ko) {
            console.log(`  KO: ${event.ko_reason}`);
          }
        }
        if (type === 'final') {
          console.log(`  Decision Hash: ${event.summary?.decision_hash?.substring(0, 16)}...`);
        }
        if (type === 'persisted') {
          console.log(`  OK: ${event.ok}, Reason: ${event.reason || 'N/A'}`);
          if (event.judgmentSaved) {
            console.log(`  Judgment Saved: YES`);
          }
          if (event.stepsSaved > 0) {
            console.log(`  Steps Saved: ${event.stepsSaved}`);
          }
          if (event.error) {
            console.log(`  Error: ${event.error}`);
          }
        }
      } catch (e) {
        console.log(`[${eventCount}] Parse error: ${line.substring(0, 100)}`);
        console.log(`  Error: ${e.message}`);
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total events: ${eventCount}`);
  console.log('Event types:', events);
  
  console.log('\n=== Validation ===');
  console.log(`✓ start: ${events.start ? 'YES' : 'NO'}`);
  console.log(`✓ engine_result (4): ${events.engine_result === 4 ? 'YES' : `NO (${events.engine_result || 0})`}`);
  console.log(`✓ base_judgment: ${events.base_judgment ? 'YES' : 'NO'}`);
  
  if (events.base_judgment) {
    // Try to get the actual event to check disagreements
    // This requires re-parsing, but for now we just check if it exists
    console.log(`✓ BASE judgment emitted`);
  }

} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}

