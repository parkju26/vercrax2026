// D:\AGENT\VERCRAX\backend\src\services\runAllToAllDebate.js
import { callOpenAI } from "../providers/openai.js";
import { callAnthropic } from "../providers/anthropic.js";
import { mockLLM } from "../providers/mock.js";

const ROLES = ["probability", "risk", "structure", "opportunity"];
const PAIRS = [
  ["probability", "risk"],
  ["probability", "structure"],
  ["probability", "opportunity"],
  ["risk", "structure"],
  ["risk", "opportunity"],
  ["structure", "opportunity"],
];

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

  if (!hasKeys && allowMock) return mockLLM({ system, user, roleKey: roleKey || "all_to_all" });

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) return callAnthropic({ system, user, signal });
  if (process.env.OPENAI_API_KEY) return callOpenAI({ system, user, signal });
  if (process.env.ANTHROPIC_API_KEY) return callAnthropic({ system, user, signal });
  return mockLLM({ system, user, roleKey: roleKey || "all_to_all" });
}

export async function runAllToAllDebate({
  prompt,
  engines,
  base,
  deep,
  providerPreference,
  signal,
  emit,
  mode,
  match_key = "all_to_all",
}) {
  const score = Object.fromEntries(ROLES.map((r) => [r, 0]));
  const matches = [];

  for (const [a, b] of PAIRS) {
    if (signal.aborted) throw new Error("aborted");

    const pair_key = `${a}__vs__${b}`;

    // A asks, B answers, Judge scores
    const qSystem = [
      `너는 Vercrax All-to-All 토론에서 "${a}" 엔진이다.`,
      "상대의 약점을 정확히 찌르는 질문 1개를 만든다.",
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
      "상대(B) 발언:",
      JSON.stringify(engines[b]?.result, null, 2),
    ].join("\n");

    const qText = await callLLM({ system: qSystem, user: qUser, providerPreference, signal, roleKey: "all_to_all_question" });
    const q = safeJson(qText);
    emit?.("all_to_all_step", { match_key, pair_key, phase: "question", challenger: a, defender: b, payload: q });

    const aSystem = [
      `너는 Vercrax All-to-All 토론에서 "${b}" 엔진이다.`,
      "질문에 답하되 회피하지 말고 수치/근거/한계를 명확히 말하라.",
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
      JSON.stringify(engines[b]?.result, null, 2),
    ].join("\n");

    const aText = await callLLM({ system: aSystem, user: aUser, providerPreference, signal, roleKey: "all_to_all_answer" });
    const ans = safeJson(aText);
    emit?.("all_to_all_step", { match_key, pair_key, phase: "answer", challenger: a, defender: b, payload: ans });

    const jSystem = [
      "너는 Vercrax All-to-All 토론 심판이다.",
      "no_numbers/evasion/repeat/contradiction/scope_cheat에 강한 패널티.",
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
      "Pair context:",
      JSON.stringify({ challenger: a, defender: b, q, ans }, null, 2),
      "",
      "채점:",
      "- 질문이 약점을 찌르면 challenger +1~+3",
      "- 답변이 정면돌파 + 수치면 defender +1~+3",
      "- 회피/반복/수치없음이면 defender -2~-5",
      "- KO는 '추가 근거를 더 못 댐'이 명확할 때만"
    ].join("\n");

    const jText = await callLLM({ system: jSystem, user: jUser, providerPreference, signal, roleKey: "all_to_all_judge" });
    const judge = safeJson(jText);

    score[a] += Number(judge?.delta?.challenger || 0);
    score[b] += Number(judge?.delta?.defender || 0);

    emit?.("all_to_all_step", {
      match_key,
      pair_key,
      phase: "judge",
      challenger: a,
      defender: b,
      payload: { judge, score: { ...score } }
    });

    matches.push({
      match_key,
      pair_key,
      challenger: a,
      defender: b,
      steps: [
        { phase: "question", payload: q },
        { phase: "answer", payload: ans },
        { phase: "judge", payload: { judge } },
      ],
      judge_summary: {
        ko: !!judge?.ko,
        ko_reason: judge?.ko_reason || null,
        loser_fail_type: judge?.loser_fail_type || "none",
        delta: judge?.delta || { challenger: 0, defender: 0 },
        why: judge?.why || [],
      }
    });
  }

  // Self revision (each engine revises its own stance after all matchups)
  const self_revision = {};
  for (const r of ROLES) {
    if (signal.aborted) throw new Error("aborted");

    const sys = [
      `너는 Vercrax의 "${r}" 엔진이다.`,
      "All-to-All 토론 결과를 반영하여, 너의 기존 주장 중 틀린/약한 부분을 수정하라.",
      "절대 결론을 고정하지 말고, '무엇이 불확실한지'를 명확히 하라.",
      "출력은 JSON만.",
      '{ "revised_claim": "...", "what_i_got_wrong": ["..."], "what_i_still_believe": ["..."], "new_numbers_needed": ["..."], "confidence": 0.0 }'
    ].join("\n");

    const usr = [
      "사용자 질문:",
      prompt,
      "",
      "너의 원래 출력:",
      JSON.stringify(engines[r]?.result, null, 2),
      "",
      "All-to-All 스코어:",
      JSON.stringify(score, null, 2),
      "",
      "All-to-All 매치 요약:",
      JSON.stringify(matches.map(m => ({
        pair_key: m.pair_key,
        challenger: m.challenger,
        defender: m.defender,
        loser_fail_type: m.judge_summary.loser_fail_type,
        ko: m.judge_summary.ko,
        ko_reason: m.judge_summary.ko_reason
      })), null, 2),
    ].join("\n");

    const txt = await callLLM({ system: sys, user: usr, providerPreference, signal, roleKey: "self_revision" });
    self_revision[r] = safeJson(txt);
    emit?.("all_to_all_self_revision", { match_key, role: r, payload: self_revision[r] });
  }

  // conflict summary (light)
  const conflict_map = summarizeConflicts(matches);

  // ranking
  const ranking = Object.entries(score).sort((a, b) => b[1] - a[1]).map(([role, points]) => ({ role, points }));
  const top2 = ranking.slice(0, 2).map(x => x.role);

  return {
    match_key,
    type: "all_to_all",
    score,
    ranking,
    top2,
    conflict_map,
    matches,
    self_revision
  };
}

function summarizeConflicts(matches) {
  // Simple heuristic: collect frequent loser_fail_type and repeated attack_types
  const failCounts = {};
  for (const m of matches) {
    const t = m.judge_summary?.loser_fail_type || "none";
    failCounts[t] = (failCounts[t] || 0) + 1;
  }
  return {
    loser_fail_type_counts: failCounts,
    note: "요약은 휴리스틱. PRO에서는 원문 트레이스를 보여주는 방식 권장."
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
