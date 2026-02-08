import { callOpenAI } from "../providers/openai.js";
import { callAnthropic } from "../providers/anthropic.js";
import { mockLLM } from "../providers/mock.js";

function pickProvider(preference) {
  const def = process.env.DEFAULT_PROVIDER;
  if (preference === "openai" || preference === "anthropic") return preference;
  if (def === "openai" || def === "anthropic") return def;
  // default
  return "openai";
}

function hasKeys() {
  return !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY;
}

export async function runRole({ roleKey, roleLabel, instruction, prompt, providerPreference, signal }) {
  const provider = pickProvider(providerPreference);

  const system = [
    `너는 Vercrax의 "${roleLabel}" 엔진이다.`,
    "단일 결론을 내리지 말고, 근거를 구조화해서 제시해라.",
    "반드시 아래 출력 형식을 지켜라.",
    "",
    "출력 형식(JSON):",
    "{",
    '  "role": "' + roleKey + '",',
    '  "claim": "핵심 주장 1문장",',
    '  "assumptions": ["전제1","전제2"],',
    '  "numbers": [{"metric":"", "value":"", "range":""}],',
    '  "reasoning": ["근거1","근거2","근거3"],',
    '  "questions_to_others": ["다른 엔진에게 던질 질문1","질문2"],',
    '  "confidence": 0.0',
    "}",
    "",
    "주의: JSON만 출력."
  ].join("\n");

  const user = [
    "사용자 질문(투자 판단 대상):",
    prompt,
    "",
    "제약:",
    "- 모르면 모른다고 말하고, 필요한 추가 데이터(티커, 가격, 기간 등)를 질문 항목에 남겨라.",
    "- 수치를 못 대면 'numbers'에 'unknown'으로 표시하고 그 이유를 적어라."
  ].join("\n");

  const allowMock = (process.env.ALLOW_MOCK_WHEN_NO_KEYS || "true").toLowerCase() === "true";

  if (!hasKeys() && allowMock) {
    const text = await mockLLM({ system, user, roleKey });
    return { provider: "mock", result: safeJson(text) };
  }

  try {
    if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
      const text = await callAnthropic({ system, user, signal });
      return { provider: "anthropic", result: safeJson(text) };
    }

    if (process.env.OPENAI_API_KEY) {
      const text = await callOpenAI({ system, user, signal });
      return { provider: "openai", result: safeJson(text) };
    }

    // fallback
    if (process.env.ANTHROPIC_API_KEY) {
      const text = await callAnthropic({ system, user, signal });
      return { provider: "anthropic", result: safeJson(text) };
    }

    const text = await mockLLM({ system, user, roleKey });
    return { provider: "mock", result: safeJson(text) };
  } catch (e) {
    // As last resort, mock so pipeline doesn't die.
    const text = await mockLLM({ system, user, roleKey, error: String(e) });
    return { provider: "mock", result: safeJson(text) };
  }
}

function safeJson(text) {
  // Remove code fences if present
  const cleaned = String(text).trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    return { parse_error: true, raw: cleaned };
  }
}
