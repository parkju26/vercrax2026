// D:\AGENT\VERCRAX\backend\src\services\verdict.js
import { callOpenAI } from "../providers/openai.js";
import { callAnthropic } from "../providers/anthropic.js";
import { mockLLM } from "../providers/mock.js";

function pickProvider(preference) {
  const def = process.env.DEFAULT_PROVIDER;
  if (preference === "openai" || preference === "anthropic") return preference;
  if (def === "openai" || def === "anthropic") return def;
  return "openai";
}

async function callLLM({ system, user, providerPreference, signal, roleKey }) {
  const provider = pickProvider(providerPreference);
  const allowMock = (process.env.ALLOW_MOCK_WHEN_NO_KEYS || "true").toLowerCase() === "true";
  const hasKeys = !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY;

  if (!hasKeys && allowMock) return mockLLM({ system, user, roleKey: roleKey || "verdict" });

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) return callAnthropic({ system, user, signal });
  if (process.env.OPENAI_API_KEY) return callOpenAI({ system, user, signal });
  if (process.env.ANTHROPIC_API_KEY) return callAnthropic({ system, user, signal });
  return mockLLM({ system, user, roleKey: roleKey || "verdict" });
}

function safeJson(text) {
  const cleaned = String(text).trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  try { return JSON.parse(cleaned); }
  catch { return { parse_error: true, raw: cleaned }; }
}

/**
 * BASE Judgment
 * - MUST include engine_disagreements >= 1
 */
export async function computeBaseJudgment({ prompt, engines, providerPreference, signal, emit }) {
  const sys = [
    "너는 Vercrax의 BASE 판정관이다.",
    "단일 결론을 정답처럼 내지 말고, 불일치를 구조화해라.",
    "출력은 JSON만.",
    '{',
    '  "label": "BUY|HOLD|SELL|UNCERTAIN",',
    '  "confidence": 0.0,',
    '  "one_liner": "...",',
    '  "why": ["..."],',
    '  "what_would_change_mind": ["..."],',
    '  "engine_disagreements": ["...","..."]',
    '}'
  ].join("\n");

  const user = [
    "사용자 질문:",
    prompt,
    "",
    "4엔진 출력:",
    JSON.stringify(engines, null, 2),
    "",
    "규칙:",
    "- disagreements는 최소 1개 이상",
    "- 데이터 부족이면 UNCERTAIN 또는 HOLD로 방어적 판단 가능"
  ].join("\n");

  const txt = await callLLM({ system: sys, user, providerPreference, signal, roleKey: "base_judge" });
  const base = safeJson(txt);

  // 강제 보정
  if (!Array.isArray(base.engine_disagreements) || base.engine_disagreements.length === 0) {
    base.engine_disagreements = ["엔진 간 전제/리스크/기회비용 평가가 불일치"];
  }
  if (typeof base.confidence !== "number") base.confidence = 0.55;
  if (!base.label) base.label = "UNCERTAIN";
  if (!base.one_liner) base.one_liner = `(${base.label}) 근거 충돌/데이터 부족으로 보수적 판단.`;

  emit?.("base_judgment", { base });
  return base;
}

/**
 * DEEP Judgment (2심)
 * - MUST NOT crash the whole pipeline
 * - returns structured JSON; if parse_error, still returns object
 */
export async function computeDeepJudgment({ prompt, engines, base, providerPreference, signal, emit }) {
  const sys = [
    "너는 Vercrax의 DEEP(2심) 분석관이다.",
    "BASE를 재판하여 결론이 바뀔 수도 있다.",
    "4개 축을 반드시 포함: 가격 시나리오, 구조적 상승여력, 기술/모멘텀 상태(추상 OK), 포트폴리오 리스크.",
    "출력은 JSON만.",
    '{',
    '  "label": "BUY|HOLD|SELL|UNCERTAIN",',
    '  "confidence": 0.0,',
    '  "cut_rules_triggered": ["..."],',
    '  "scenarios": [{"name":"base","prob":0.0,"up":"...","down":"..."}],',
    '  "axes": {',
    '     "price_scenarios": ["..."],',
    '     "structural_upside": ["..."],',
    '     "tech_state": ["..."],',
    '     "portfolio_risk": ["..."]',
    '  },',
    '  "why": ["..."],',
    '  "what_data_needed": ["..."]',
    '}'
  ].join("\n");

  const user = [
    "사용자 질문:",
    prompt,
    "",
    "BASE:",
    JSON.stringify(base, null, 2),
    "",
    "4엔진 출력:",
    JSON.stringify(engines, null, 2),
    "",
    "컷룰 힌트:",
    "- 손실 크게 못 봄: 하방 시나리오/리스크가 불명확하면 BUY 금지",
    "- 수치가 없으면 what_data_needed에 명시"
  ].join("\n");

  const txt = await callLLM({ system: sys, user, providerPreference, signal, roleKey: "deep_judge" });
  const deep = safeJson(txt);

  if (typeof deep.confidence !== "number") deep.confidence = Math.min(0.65, Number(base?.confidence || 0.55));
  if (!deep.label) deep.label = base?.label || "UNCERTAIN";
  if (!deep.axes) deep.axes = { price_scenarios: [], structural_upside: [], tech_state: [], portfolio_risk: [] };
  if (!Array.isArray(deep.cut_rules_triggered)) deep.cut_rules_triggered = [];
  if (!Array.isArray(deep.scenarios)) deep.scenarios = [{ name: "base", prob: 0.5, up: "상방 근거 부족", down: "하방 근거 부족" }];
  if (!Array.isArray(deep.why)) deep.why = ["DEEP 분석: 입력 데이터 부족 시 보수적으로 유지."];
  if (!Array.isArray(deep.what_data_needed)) deep.what_data_needed = ["티커/현재가", "기간", "리스크 한도(손절 기준)"];

  emit?.("deep_judgment", { deep });
  return deep;
}
