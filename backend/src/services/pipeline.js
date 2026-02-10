// D:\AGENT\VERCRAX\backend\src\services\pipeline.js
import crypto from "crypto";
import { runFourEngines } from "./runFourEngines.js";
import { computeBaseJudgment, computeDeepJudgment } from "./verdict.js";
import { runArenaDebate } from "./runArenaDebate.js";
import { runAllToAllDebate } from "./runAllToAllDebate.js";
import { saveFullRun } from "../storage/save.js";
import { buildHashChain, sha256 } from "./hashChain.js";

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

  const hc = buildHashChain();
  hc.addStep("prompt", { prompt, mode, debate, userId, requestId });

  // 1) Engines (절대 끊기지 않게)
  let engines = null;
  try {
    engines = await runFourEngines({ prompt, providerPreference, signal, emit, logger });
    hc.addStep("engines", engines);
  } catch (e) {
    const msg = String(e?.message || e);
    emit("engine_error", { where: "runFourEngines", error: msg, stack: String(e?.stack || "") });
    hc.addStep("engine_error", { error: msg });
    // 엔진이 없으면 이후가 의미 없으니 final로 종료
    const finalEarly = buildFinal({ ok: false, runId, startedAt, userId, requestId, mode, debate, prompt, engines, base: null, deep: null, debateResult: { type: "failed", stage: "engines", error: msg }, hc });
    await persistBestEffort(finalEarly, emit, logger);
    return finalEarly;
  }

  // 2) BASE
  let base = null;
  try {
    base = await computeBaseJudgment({ prompt, engines, providerPreference, signal, emit, logger });
    hc.addStep("base_judgment", base);
  } catch (e) {
    const msg = String(e?.message || e);
    emit("base_error", { where: "computeBaseJudgment", error: msg, stack: String(e?.stack || "") });
    hc.addStep("base_error", { error: msg });
    const finalEarly = buildFinal({ ok: false, runId, startedAt, userId, requestId, mode, debate, prompt, engines, base: null, deep: null, debateResult: { type: "failed", stage: "base", error: msg }, hc });
    await persistBestEffort(finalEarly, emit, logger);
    return finalEarly;
  }

  // 3) DEEP (여기가 지금 너가 터지는 구간) — 실패해도 끊기지 않게
  let deep = null;
  if (mode === "deep") {
    try {
      deep = await computeDeepJudgment({ prompt, engines, base, providerPreference, signal, emit, logger });
      hc.addStep("deep_judgment", deep);
    } catch (e) {
      const msg = String(e?.message || e);
      emit("deep_error", { where: "computeDeepJudgment", error: msg, stack: String(e?.stack || "") });
      // deep 실패해도 진행은 계속
      deep = { label: base.label, confidence: base.confidence, error: msg };
      hc.addStep("deep_error", { error: msg });
    }
  } else {
    hc.addStep("deep_judgment", null);
  }

  // 4) Debate
  let debateResult = null;
  try {
    if (debate === "none") {
      debateResult = null;
    } else if (debate === "all") {
      const all = await runAllToAllDebate({ prompt, engines, base, deep, providerPreference, signal, emit, mode, match_key: "all_to_all" });
      emit("debate_all_to_all_final", { summary: { ranking: all.ranking, top2: all.top2, conflict_map: all.conflict_map } });
      hc.addStep("debate_all_to_all", { score: all.score, ranking: all.ranking, top2: all.top2, conflict_map: all.conflict_map });

      if (all.top2?.length === 2) {
        const [a, b] = all.top2;
        const finalMatch = await runArenaDebate({
          prompt, engines, base, deep,
          providerPreference, signal, emit, logger,
          mode, debate: "arena",
          roundsOverride: 3,
          pairsOverride: [[a, b]],
          match_key: "final_match"
        });
        hc.addStep("debate_final_match", finalMatch);
        debateResult = { type: "all_to_all_plus_final", all_to_all: all, final_match: finalMatch };
      } else {
        debateResult = { type: "all_to_all_only", all_to_all: all, final_match: null };
      }
    } else {
      const arena = await runArenaDebate({ prompt, engines, base, deep, providerPreference, signal, emit, logger, mode, debate, match_key: "arena" });
      hc.addStep("debate_arena", arena);
      debateResult = arena;
    }
  } catch (e) {
    const msg = String(e?.message || e);
    emit("debate_error", { where: "debate", error: msg, stack: String(e?.stack || "") });
    debateResult = { type: "debate_failed", error: msg };
    hc.addStep("debate_failed", debateResult);
  }

  // 5) Final (무조건)
  const final = buildFinal({ ok: true, runId, startedAt, userId, requestId, mode, debate, prompt, engines, base, deep, debateResult, hc });

  emit("final", { summary: { base_label: base?.label ?? null, winner: extractWinner(debateResult), chain_head_hash: final.integrity.chain_head_hash } });

  await persistBestEffort(final, emit, logger);
  return final;
}

function buildFinal({ ok, runId, startedAt, userId, requestId, mode, debate, prompt, engines, base, deep, debateResult, hc }) {
  const chain_head_hash = hc.head();
  const decision_snapshot_hash = sha256(JSON.stringify({ prompt, engines, base, deep, debate: debateResult }));

  return {
    ok,
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
      chain_head_hash,
      hash_chain: hc.chain,
      decision_snapshot_hash
    }
  };
}

async function persistBestEffort(final, emit, logger) {
  try {
    await saveFullRun(final);
    emit("persisted", { ok: true });
  } catch (e) {
    emit("persisted", { ok: false, error: String(e?.message || e) });
    logger?.warn?.({ err: String(e) }, "persist failed");
  }
}

function extractWinner(debateResult) {
  if (!debateResult) return null;
  if (debateResult?.type === "all_to_all_plus_final") return debateResult?.final_match?.winner ?? null;
  if (debateResult?.winner) return debateResult.winner;
  return null;
}
