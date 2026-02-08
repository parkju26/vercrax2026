// Direct test of runArenaDebate
import { runArenaDebate } from '../backend/src/services/runArenaDebate.js';

const mockEngines = {
  probability: { result: { role: "probability", claim: "test", confidence: 0.7 } },
  risk: { result: { role: "risk", claim: "test", confidence: 0.6 } },
  structure: { result: { role: "structure", claim: "test", confidence: 0.8 } },
  opportunity: { result: { role: "opportunity", claim: "test", confidence: 0.75 } }
};

const mockBase = {
  label: "HOLD",
  confidence: 0.6,
  one_liner: "Test base",
  engine_disagreements: ["Test disagreement"]
};

const events = [];
const emit = (type, payload) => {
  events.push({ type, ...payload });
  console.log(`[EVENT] ${type}`, JSON.stringify(payload, null, 2).substring(0, 200));
};

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.log('[WARN]', ...args),
  error: (...args) => console.log('[ERROR]', ...args)
};

console.log('=== Testing runArenaDebate directly ===\n');

try {
  const result = await runArenaDebate({
    prompt: "Test prompt",
    engines: mockEngines,
    base: mockBase,
    deep: null,
    providerPreference: null,
    signal: new AbortController().signal,
    emit,
    logger,
    mode: "base",
    debate: "arena"
  });
  
  console.log('\n=== Result ===');
  console.log(JSON.stringify(result, null, 2));
  
  console.log('\n=== Events ===');
  console.log(`Total events: ${events.length}`);
  const debateSteps = events.filter(e => e.type === 'debate_step');
  console.log(`Debate steps: ${debateSteps.length}`);
  
} catch (err) {
  console.error('Error:', err);
  console.error('Stack:', err.stack);
}

