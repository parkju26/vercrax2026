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

const PAIRS = [
  ["probability", "risk"],
  ["structure", "opportunity"],
  ["risk", "structure"],
  ["opportunity", "probability"]
];

// Arena is round-based: challenger -> question, defender -> answer, judge -> score delta.
export async function runArenaDebate({ prompt, engines, base, deep, providerPreference, signal, emit, logger, mode, debate }) {
  logger?.info({ 
    enginesKeys: Object.keys(engines), 
    enginesStructure: Object.keys(engines).map(k => ({ 
      key: k, 
      hasProvider: !!engines[k]?.provider, 
      hasResult: !!engines[k]?.result,
      resultType: typeof engines[k]?.result
    })),
    hasBase: !!base,
    baseLabel: base?.label
  }, "runArenaDebate started");
  
  const rounds = debate === "all" ? 6 : 4; // "arena" default 4 rounds
  const steps = [];
  const score = { probability: 0, risk: 0, structure: 0, opportunity: 0 };
  
  // Validate engines structure - ensure all required engines exist with results
  const requiredEngines = ["probability", "risk", "structure", "opportunity"];
  for (const key of requiredEngines) {
    if (!engines[key]) {
      logger?.error({ key, availableKeys: Object.keys(engines) }, "Missing engine");
      throw new Error(`Missing engine: ${key}. Available: ${Object.keys(engines).join(", ")}`);
    }
    if (!engines[key].result) {
      logger?.warn({ key, engine: engines[key] }, "Engine missing result, using fallback");
      // Create minimal fallback result
      engines[key].result = {
        role: key,
        claim: "엔진 결과 없음",
        assumptions: [],
        numbers: [],
        reasoning: ["데이터 부족"],
        questions_to_others: [],
        confidence: 0.5
      };
    }
  }
  
  logger?.info({ validatedEngines: requiredEngines }, "Engines validated, starting rounds");

  for (let i = 0; i < rounds; i++) {
    if (signal.aborted) {
      logger?.warn("Signal aborted, stopping debate");
      throw new Error("aborted");
    }

    const [challenger, defender] = PAIRS[i % PAIRS.length];
    logger?.info({ round: i + 1, totalRounds: rounds, challenger, defender }, "Starting round");

    try {
      // Question phase
      let q;
      try {
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
          JSON.stringify(engines[defender]?.result, null, 2)
        ].join("\n");

        logger?.info({ round: i + 1, phase: "question", challenger, defender }, "Generating question");
        const qText = await callLLM({ system: qSystem, user: qUser, providerPreference, signal });
        logger?.debug({ round: i + 1, qTextLength: qText?.length, qTextPreview: qText?.substring(0, 100) }, "Question LLM response");
        q = safeJson(qText);
        if (q.parse_error) {
          logger?.warn({ raw: q.raw?.substring(0, 200) }, "Question parse error, using fallback");
          q = { question: "전제 검증이 필요한가?", attack_type: "assumptions", why_this_matters: "전제 확인 필요" };
        }
      } catch (err) {
        logger?.error({ err: String(err), stack: err?.stack }, "Question generation failed");
        q = { question: "전제 검증이 필요한가?", attack_type: "assumptions", why_this_matters: "오류 발생" };
      }

      logger?.info({ round: i + 1, phase: "question", challenger, defender, question: q.question?.substring(0, 50) }, "Emitting question");
      emit("debate_step", { phase: "question", round: i + 1, challenger, defender, payload: q });
      steps.push({ round: i + 1, challenger, defender, phase: "question", payload: q });

      // Answer phase
      let a;
      try {
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
          JSON.stringify(engines[defender]?.result, null, 2)
        ].join("\n");

        logger?.info({ round: i + 1, phase: "answer", challenger, defender }, "Generating answer");
        const aText = await callLLM({ system: aSystem, user: aUser, providerPreference, signal });
        logger?.debug({ round: i + 1, aTextLength: aText?.length, aTextPreview: aText?.substring(0, 100) }, "Answer LLM response");
        a = safeJson(aText);
        if (a.parse_error) {
          logger?.warn({ raw: a.raw?.substring(0, 200) }, "Answer parse error, using fallback");
          a = { answer: "추가 데이터가 필요하지만, 현재 가정 하에서는 가능성 있음", evidence: ["가정 기반"], numbers: [{ metric: "unknown", value: "unknown", range: "unknown" }], concede: false, concede_reason: "" };
        }
      } catch (err) {
        logger?.error({ err: String(err), stack: err?.stack }, "Answer generation failed");
        a = { answer: "추가 데이터 필요", evidence: [], numbers: [], concede: false, concede_reason: "" };
      }

      logger?.info({ round: i + 1, phase: "answer", challenger, defender, answer: a.answer?.substring(0, 50) }, "Emitting answer");
      emit("debate_step", { phase: "answer", round: i + 1, challenger, defender, payload: a });
      steps.push({ round: i + 1, challenger, defender, phase: "answer", payload: a });

      // Judge phase
      let judge;
      try {
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
          '  "loser_fail_type": "repeat|evasion|no_numbers|contradiction|none"',
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
          "- KO는 '추가 근거를 더 못 댐'이 명확할 때만 true"
        ].join("\n");

        logger?.info({ round: i + 1, phase: "judge", challenger, defender }, "Generating judgment");
        const jText = await callLLM({ system: jSystem, user: jUser, providerPreference, signal });
        logger?.debug({ round: i + 1, jTextLength: jText?.length, jTextPreview: jText?.substring(0, 100) }, "Judge LLM response");
        judge = safeJson(jText);
        if (judge.parse_error) {
          logger?.warn({ raw: judge.raw?.substring(0, 200) }, "Judge parse error, using fallback");
          judge = { delta: { challenger: 1, defender: -1 }, ko: false, ko_reason: "", why: ["기본 판정"], loser_fail_type: "none" };
        }
      } catch (err) {
        logger?.error({ err: String(err), stack: err?.stack }, "Judgment generation failed");
        judge = { delta: { challenger: 1, defender: -1 }, ko: false, ko_reason: "", why: ["오류 발생"], loser_fail_type: "none" };
      }

      score[challenger] += Number(judge?.delta?.challenger || 0);
      score[defender] += Number(judge?.delta?.defender || 0);

      logger?.info({ round: i + 1, phase: "judge", challenger, defender, score: { ...score }, ko: judge?.ko }, "Emitting judgment");
      emit("debate_step", { phase: "judge", round: i + 1, challenger, defender, payload: { judge, score: { ...score } } });
      steps.push({ round: i + 1, challenger, defender, phase: "judge", payload: { judge, score: { ...score } } });

      if (judge?.ko) {
        const loser = defender;
        const winner = challenger;
        const result = finalize({ score, steps, winner, loser, ko_reason: judge?.ko_reason || "KO", judge });
        emit("debate_final", result);
        logger?.info({ winner, loser, ko: true }, "KO detected, ending debate early");
        return result;
      }
      
      logger?.info({ round: i + 1, completed: true, score: { ...score } }, "Round completed");
    } catch (roundErr) {
      logger?.error({ round: i + 1, err: String(roundErr), stack: roundErr?.stack }, "Round failed, continuing to next round");
      // Continue to next round even if this one failed
      // Emit a fallback step to show the error
      emit("debate_step", { 
        phase: "error", 
        round: i + 1, 
        challenger, 
        defender, 
        payload: { error: String(roundErr) } 
      });
    }
  }

  // Winner by score
  const winner = Object.entries(score).sort((a, b) => b[1] - a[1])[0]?.[0] || "draw";
  const top2 = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const isDraw = top2.length === 2 && Math.abs(top2[0][1] - top2[1][1]) <= 1;

  const result = finalize({
    score,
    steps,
    winner: isDraw ? "draw" : winner,
    loser: isDraw ? null : top2[1]?.[0] || null,
    ko_reason: null,
    judge: null
  });

  emit("debate_final", result);
  logger?.info({ winner: result.winner }, "debate done");
  return result;
}

function finalize({ score, steps, winner, loser, ko_reason, judge }) {
  const why_one_liner = winner === "draw"
    ? "점수 차가 작고, 핵심 전제 충돌이 해소되지 않아 무승부."
    : `${winner}가 더 일관된 근거/수치로 상대 약점을 압도.`;

  return {
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
