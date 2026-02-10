// D:\AGENT\VERCRAX\backend\src\services\runArenaDebate.js
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

  if (!hasKeys && allowMock) return mockLLM({ system, user, roleKey: "arena" });

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) return callAnthropic({ system, user, signal });
  if (process.env.OPENAI_API_KEY) return callOpenAI({ system, user, signal });
  if (process.env.ANTHROPIC_API_KEY) return callAnthropic({ system, user, signal });
  return mockLLM({ system, user, roleKey: "arena" });
}

const DEFAULT_PAIRS = [
  ["probability", "risk"],
  ["structure", "opportunity"],
  ["risk", "structure"],
  ["opportunity", "probability"],
];

export async function runArenaDebate({
  prompt,
  engines,
  base,
  deep,
  providerPreference,
  signal,
  emit,
  logger,
  mode,
  debate,
  roundsOverride = null,
  pairsOverride = null,
  match_key = "arena",
}) {
  const pairs = pairsOverride?.length ? pairsOverride : DEFAULT_PAIRS;
  const rounds = typeof roundsOverride === "number"
    ? roundsOverride
    : (debate === "all" ? 6 : 4);

  const steps = [];
  const score = { probability: 0, risk: 0, structure: 0, opportunity: 0 };

  for (let i = 0; i < rounds; i++) {
    if (signal.aborted) throw new Error("aborted");

    const [challenger, defender] = pairs[i % pairs.length];

    // 1) Question
    const qSystem = [
      `너는 Vercrax 토론에서 "${challenger}" 엔진 역할이다.`,
      "목표: 상대의 약점(전제, 수치, 논리의 비약, 회피)을 정확히 찌르는 '1개 질문'을 만든다.",
      "출력은 JSON만.",
      '{ "question": "...", "attack_type": "numbers|assumptions|logic|scope|evasion", "why_this_matters": "..." }'
    ].join("\n");

    const qUser = [
      "사용자 질문:",
      prompt,
      "",
      "BASE:",
      JSON.stringify(base, null, 2),
      "",
      mode === "deep" ? "DEEP:" : "",
      mode === "deep" ? JSON.stringify(deep, null, 2) : "",
      "",
      "상대(defender) 발언:",
      JSON.stringify(engines[defender]?.result, null, 2),
    ].join("\n");

    const qText = await callLLM({ system: qSystem, user: qUser, providerPreference, signal });
    const q = safeJson(qText);

    emit?.("debate_step", { match_key, phase: "question", round: i + 1, challenger, defender, payload: q });
    steps.push({ match_key, round: i + 1, challenger, defender, phase: "question", payload: q });

    // 2) Answer
    const aSystem = [
      `너는 Vercrax 토론에서 "${defender}" 엔진 역할이다.`,
      "질문에 답하되, 회피하지 말고 수치/근거/한계를 명확히 말하라.",
      "출력은 JSON만.",
      '{ "answer": "...", "evidence": ["..."], "numbers": [{"metric":"","value":"","range":""}], "concede": false, "concede_reason": "" }'
    ].join("\n");

    const aUser = [
      "사용자 질문:",
      prompt,
      "",
      "질문:",
      JSON.stringify(q, null, 2),
      "",
      "너의 이전 발언:",
      JSON.stringify(engines[defender]?.result, null, 2),
    ].join("\n");

    const aText = await callLLM({ system: aSystem, user: aUser, providerPreference, signal });
    const a = safeJson(aText);

    emit?.("debate_step", { match_key, phase: "answer", round: i + 1, challenger, defender, payload: a });
    steps.push({ match_key, round: i + 1, challenger, defender, phase: "answer", payload: a });

    // 3) Judge
    const jSystem = [
      "너는 Vercrax의 토론 심판이다.",
      "질문 회피/근거 반복/수치 미제시에는 강한 패널티.",
      "가능하면 KO(기술패) 조건을 판단해라.",
      "출력은 JSON만.",
      "{",
      '  "delta": { "challenger": 0, "defender": 0 },',
      '  "ko": false,',
      '  "ko_reason": "",',
      '  "why": ["판정 근거1","2"],',
      '  "loser_fail_type": "repeat|evasion|no_numbers|contradiction|scope_cheat|none"',
      "}"
    ].join("\n");

    const jUser = [
      "사용자 질문:",
      prompt,
      "",
      "Round context:",
      JSON.stringify({ challenger, defender, q, a }, null, 2),
      "",
      "채점 규칙:",
      "- 질문이 정확히 약점을 찌르면 challenger +1~+3",
      "- 답변이 정면돌파 + 수치/근거면 defender +1~+3",
      "- 회피/반복/수치없음이면 defender -2~-5 (challenger는 상대적 +)",
      "- KO는 '추가 근거를 더 못 댐'이 명확할 때만 true",
      "- scope_cheat(질문 바꿔치기) 강한 감점"
    ].join("\n");

    const jText = await callLLM({ system: jSystem, user: jUser, providerPreference, signal });
    const judge = safeJson(jText);

    score[challenger] += Number(judge?.delta?.challenger || 0);
    score[defender] += Number(judge?.delta?.defender || 0);

    emit?.("debate_step", { match_key, phase: "judge", round: i + 1, challenger, defender, payload: { judge, score: { ...score } } });
    steps.push({ match_key, round: i + 1, challenger, defender, phase: "judge", payload: { judge, score: { ...score } } });

    if (judge?.ko) {
      const loser = defender;
      const winner = challenger;
      const result = finalize({ match_key, score, steps, winner, loser, ko_reason: judge?.ko_reason || "KO" });
      emit?.("debate_final", result);
      return result;
    }
  }

  const ranking = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const winner = ranking[0]?.[0] || "draw";
  const top2 = ranking.slice(0, 2);
  const isDraw = top2.length === 2 && Math.abs(top2[0][1] - top2[1][1]) <= 1;

  const result = finalize({
    match_key,
    score,
    steps,
    winner: isDraw ? "draw" : winner,
    loser: isDraw ? null : (top2[1]?.[0] || null),
    ko_reason: null
  });

  emit?.("debate_final", result);
  logger?.info?.({ match_key, winner: result.winner }, "arena debate done");
  return result;
}

function finalize({ match_key, score, steps, winner, loser, ko_reason }) {
  const why_one_liner = winner === "draw"
    ? "점수 차가 작고, 핵심 전제 충돌이 해소되지 않아 무승부."
    : `${winner}가 더 일관된 근거/수치로 상대 약점을 압도.`;

  return {
    match_key,
    winner,
    loser,
    ko: !!ko_reason,
    ko_reason,
    why_one_liner,
    score,
    steps
  };
}

function safeJson(text) {
  const cleaned = String(text).trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try { return JSON.parse(cleaned); }
  catch { return { parse_error: true, raw: cleaned }; }
}
