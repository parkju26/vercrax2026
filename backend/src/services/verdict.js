import { callOpenAI } from "../providers/openai.js";
import { callAnthropic } from "../providers/anthropic.js";
import { mockLLM } from "../providers/mock.js";

function pickProvider(preference) {
  const def = process.env.DEFAULT_PROVIDER;
  if (preference === "openai" || preference === "anthropic") return preference;
  if (def === "openai" || def === "anthropic") return def;
  return "openai";
}

async function callLLM({ system, user, providerPreference, signal }) {
  const provider = pickProvider(providerPreference);
  const allowMock = (process.env.ALLOW_MOCK_WHEN_NO_KEYS || "true").toLowerCase() === "true";
  const hasKeys = !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY;

  if (!hasKeys && allowMock) return mockLLM({ system, user, roleKey: "verdict" });

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) return callAnthropic({ system, user, signal });
  if (process.env.OPENAI_API_KEY) return callOpenAI({ system, user, signal });
  if (process.env.ANTHROPIC_API_KEY) return callAnthropic({ system, user, signal });
  return mockLLM({ system, user, roleKey: "verdict" });
}

export async function computeBaseJudgment({ prompt, engines, providerPreference, signal, emit, logger }) {
  const system = [
    "너는 Vercrax의 'BASE 판단' 심판이다.",
    "단일 정답처럼 말하지 말고, 4 엔진의 충돌을 그대로 반영하라.",
    "출력은 JSON만.",
    "",
    "출력 형식(JSON):",
    "{",
    '  "label": "BUY|HOLD|SELL|UNCERTAIN",',
    '  "confidence": 0.0,',
    '  "one_liner": "핵심 결론 1문장",',
    '  "why": ["근거1","근거2","근거3"],',
    '  "what_would_change_mind": ["추가로 확인할 데이터1","데이터2"],',
    '  "engine_disagreements": ["어떤 부분이 충돌하는지1","2"]',
    "}"
  ].join("\n");

  const user = [
    "사용자 질문:",
    prompt,
    "",
    "4 엔진 출력:",
    JSON.stringify(engines, null, 2),
    "",
    "규칙:",
    "- confidence는 0~1 사이",
    "- 충돌(불일치)을 최소 1개 이상 명시",
    "- 'engine_disagreements'는 빈 배열 금지"
  ].join("\n");

  let text;
  try {
    text = await callLLM({ system, user, providerPreference, signal });
  } catch (err) {
    logger?.error({ err: String(err) }, "callLLM failed in computeBaseJudgment");
    text = await mockLLM({ system, user, roleKey: "verdict", error: String(err) });
  }
  
  const base = safeJson(text);
  if (base.parse_error) {
    logger?.warn({ raw: base.raw }, "Base judgment parse error, using mock fallback");
    // Use mock directly
    const mockText = await mockLLM({ system, user, roleKey: "verdict" });
    const mockBase = safeJson(mockText);
    if (!mockBase.parse_error) {
      emit("base_judgment", { base: mockBase });
      logger?.info({ label: mockBase?.label, confidence: mockBase?.confidence }, "base judgment done (mock fallback)");
      return mockBase;
    }
  }
  
  // Ensure engine_disagreements exists and has at least 1 item
  if (!base.engine_disagreements || base.engine_disagreements.length === 0) {
    base.engine_disagreements = ["4개 엔진의 관점 차이 존재"];
  }
  
  emit("base_judgment", { base });
  logger?.info({ label: base?.label, confidence: base?.confidence }, "base judgment done");
  return base;
}

export async function computeDeepJudgment({ prompt, engines, base, providerPreference, signal, emit }) {
  const system = [
    "너는 Vercrax의 'DEEP 분석' 심판이다.",
    "시나리오/구조/신뢰도 컷룰을 반드시 포함하라.",
    "출력은 JSON만.",
    "",
    "출력 형식(JSON):",
    "{",
    '  "scenarios": [{"name":"", "prob":0.0, "upside":"", "downside":"", "triggers":[""]}],',
    '  "structure_score": {"0-100": 0, "why": [""]},',
    '  "credibility_cuts": [{"rule":"", "pass":true, "why":""}],',
    '  "risk_controls": [{"action":"", "condition":"", "rationale":""}],',
    '  "summary": "딥 분석 요약 1문장"',
    "}"
  ].join("\n");

  const user = [
    "사용자 질문:",
    prompt,
    "",
    "BASE 판단:",
    JSON.stringify(base, null, 2),
    "",
    "4 엔진 출력:",
    JSON.stringify(engines, null, 2),
    "",
    "규칙:",
    "- scenarios는 최소 3개",
    "- prob의 합은 1.0 근처(대략)",
    "- credibility_cuts는 최소 3개(예: 데이터 부재, 밸류에이션 과열, 촉매 부재 등)"
  ].join("\n");

  const text = await callLLM({ system, user, providerPreference, signal });
  const deep = safeJson(text);
  emit("deep_judgment", { deep });
  return deep;
}

function safeJson(text) {
  const cleaned = String(text).trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try { return JSON.parse(cleaned); }
  catch { return { parse_error: true, raw: cleaned }; }
}
