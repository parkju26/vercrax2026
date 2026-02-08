import crypto from "crypto";
import { runFourEngines } from "./runFourEngines.js";
import { computeBaseJudgment, computeDeepJudgment } from "./verdict.js";
import { runArenaDebate } from "./runArenaDebate.js";
import { saveFullRun } from "../storage/save.js";

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function runJudgmentPipeline({
  userId,
  requestId,
  prompt,
  mode,
  debate,
  providerPreference,
  signal,
  onEvent,
  logger
}) {
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();

  const emit = (type, payload) => onEvent?.({ type, run_id: runId, ts: new Date().toISOString(), ...payload });

  emit("start", { request_id: requestId, user_id: userId, mode, debate });

  // 1) 4 engines in parallel
  const engines = await runFourEngines({
    prompt,
    providerPreference,
    signal,
    emit,
    logger
  });
  
  // Validate engines structure
  logger?.info({ engineKeys: Object.keys(engines), engineStructure: Object.keys(engines).map(k => ({ key: k, hasResult: !!engines[k]?.result })) }, "Engines completed");

  // 2) BASE judgment
  let base;
  try {
    base = await computeBaseJudgment({ prompt, engines, providerPreference, signal, emit, logger });
  } catch (err) {
    logger?.error({ err: String(err) }, "computeBaseJudgment failed");
    // Fallback: create minimal base judgment
    base = {
      label: "UNCERTAIN",
      confidence: 0.5,
      one_liner: "BASE 판단 중 오류 발생",
      why: [String(err)],
      what_would_change_mind: [],
      engine_disagreements: ["오류로 인해 판단 불가"]
    };
    emit("base_judgment", { base });
  }

  // 3) DEEP (optional)
  const deep = mode === "deep"
    ? await computeDeepJudgment({ prompt, engines, base, providerPreference, signal, emit, logger })
    : null;

  // 4) Debate (optional)
  let debateResult = null;
  if (debate !== "none") {
    try {
      logger?.info({ debate, enginesCount: Object.keys(engines).length, hasBase: !!base, baseLabel: base?.label }, "Starting arena debate");
      if (!base || Object.keys(engines).length === 0) {
        throw new Error(`Missing base judgment or engines for debate. base: ${!!base}, engines: ${Object.keys(engines).length}`);
      }
      // Validate engines structure
      for (const [key, value] of Object.entries(engines)) {
        if (!value || !value.result) {
          logger?.warn({ key, value }, "Engine missing result");
        }
      }
      
      // Wrap runArenaDebate to catch any synchronous errors
      try {
        debateResult = await runArenaDebate({ prompt, engines, base, deep, providerPreference, signal, emit, logger, mode, debate });
        logger?.info({ winner: debateResult?.winner, stepsCount: debateResult?.steps?.length }, "Arena debate completed");
      } catch (debateErr) {
        logger?.error({ err: String(debateErr), stack: debateErr?.stack, name: debateErr?.name }, "runArenaDebate threw error");
        throw debateErr; // Re-throw to outer catch
      }
    } catch (err) {
      logger?.error({ err: String(err), stack: err?.stack, debate, hasBase: !!base, enginesKeys: Object.keys(engines) }, "runArenaDebate failed");
      // Fallback: create minimal debate result with at least one step for UI
      const fallbackStep = {
        round: 1,
        challenger: "probability",
        defender: "risk",
        phase: "question",
        payload: { question: "토론 중 오류 발생", error: String(err) }
      };
      emit("debate_step", fallbackStep);
      debateResult = {
        winner: "draw",
        loser: null,
        ko: false,
        ko_reason: null,
        why_one_liner: `토론 중 오류 발생: ${String(err)}`,
        score: { probability: 0, risk: 0, structure: 0, opportunity: 0 },
        steps: [fallbackStep]
      };
      emit("debate_final", debateResult);
    }
  }

  // 5) Integrity hash over the chain (reproducible-ish)
  const chainSteps = {
    prompt,
    engines,
    base,
    deep,
    debate: debateResult
  };
  const decision_hash = sha256(JSON.stringify(chainSteps));

  const final = {
    ok: true,
    run_id: runId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    user_id: userId,
    request_id: requestId,
    mode,
    debate,
    base_judgment: base,
    deep,
    debate_result: debateResult,
    integrity: {
      decision_hash,
      chain_steps: chainSteps
    }
  };

  emit("final", { summary: { base, winner: debateResult?.winner || null, decision_hash } });

  // 6) Persist (best-effort) - 저장 실패해도 스트리밍은 끝까지 유지
  // saveFullRun은 이제 에러를 throw하지 않고 결과 객체를 반환함
  const persistResult = await saveFullRun(final);
  emit("persisted", { 
    ok: persistResult.ok, 
    reason: persistResult.reason || null,
    judgmentSaved: persistResult.judgmentSaved || false, 
    stepsSaved: persistResult.stepsSaved || 0,
    error: persistResult.error || null
  });
  
  if (persistResult.ok) {
    logger?.info({ persistResult }, "Persist completed successfully");
  } else {
    logger?.warn({ persistResult }, "Persist failed (ignored, streaming continues)");
  }
  // 스트리밍은 계속 진행됨 - 저장 실패해도 final 이벤트는 이미 emit됨

  return final;
}
