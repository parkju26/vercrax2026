// D:\AGENT\VERCRAX\backend\src\storage\save.js
import { getSupabaseAdmin } from "./supabaseAdmin.js";

export async function saveFullRun(final) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  const supabase = getSupabaseAdmin();

  const prompt =
    final?.integrity?.hash_chain?.find((s) => s.step_type === "prompt")?.payload?.prompt ||
    final?.prompt ||
    "";

  // ✅ DB NOT NULL 방어
  const baseFallback = {
    label: "UNCERTAIN",
    confidence: 0.0,
    one_liner: "BASE 생성 실패(클라이언트 중단/오류). 디버그 로그를 확인하세요.",
    why: ["base_judgment가 생성되지 않았습니다."],
    what_would_change_mind: [],
    engine_disagreements: ["BASE 생성 실패로 불일치 분석 불가"]
  };

  // 1) judgments upsert
  const judgmentRow = {
    run_id: final.run_id,
    user_id: final.user_id || "unknown",
    request_id: final.request_id || "unknown",
    prompt: prompt || "(empty)",
    mode: final.mode || "base",
    debate: final.debate || "none",
    base_judgment: final.base_judgment ?? baseFallback,
    deep: final.deep ?? null,
    debate_result: final.debate_result ?? null,

    chain_head_hash: final.integrity?.chain_head_hash || null,
    hash_chain: final.integrity?.hash_chain || null,
    decision_snapshot_hash: final.integrity?.decision_snapshot_hash || null,

    created_at: final.finished_at || new Date().toISOString()
  };

  const { error: jErr } = await supabase
    .from("judgments")
    .upsert(judgmentRow, { onConflict: "run_id" });

  if (jErr) throw new Error(`supabase judgments upsert failed: ${jErr.message}`);

  // 2) debate_steps: build rows
  const stepRows = [];

  // (A) arena direct (debate_result.steps)
  if (final.debate_result?.steps?.length) {
    for (const s of final.debate_result.steps) {
      stepRows.push({
        run_id: final.run_id,
        match_key: s.match_key || final.debate_result.match_key || "arena",
        pair_key: `${s.challenger || "x"}__vs__${s.defender || "y"}`,
        round: s.round || 0,
        challenger: s.challenger || null,
        defender: s.defender || null,
        phase: s.phase,
        payload: s.payload ?? {}
      });
    }
  }

  // (B) all_to_all_plus_final
  if (final.debate_result?.type === "all_to_all_plus_final") {
    const all = final.debate_result.all_to_all;

    // all-to-all match steps
    if (all?.matches?.length) {
      for (const m of all.matches) {
        for (const st of (m.steps || [])) {
          stepRows.push({
            run_id: final.run_id,
            match_key: m.match_key || "all_to_all",
            pair_key: m.pair_key || `${m.challenger}__vs__${m.defender}`,
            round: st.round || 1,
            challenger: m.challenger || null,
            defender: m.defender || null,
            phase: st.phase,
            payload: st.payload ?? {}
          });
        }
      }
    }

    // final match steps
    const fm = final.debate_result.final_match;
    if (fm?.steps?.length) {
      for (const s of fm.steps) {
        stepRows.push({
          run_id: final.run_id,
          match_key: s.match_key || "final_match",
          pair_key: `${s.challenger || "x"}__vs__${s.defender || "y"}`,
          round: s.round || 0,
          challenger: s.challenger || null,
          defender: s.defender || null,
          phase: s.phase,
          payload: s.payload ?? {}
        });
      }
    }
  }

  // ✅ 핵심 FIX: idx를 “마지막에” 0..N-1로 재부여해서 PK 중복 0%
  if (stepRows.length) {
    // 먼저 기존 run_id rows 제거
    await supabase.from("debate_steps").delete().eq("run_id", final.run_id);

    const normalized = stepRows.map((r, i) => ({ ...r, idx: i }));

    const { error: sErr } = await supabase.from("debate_steps").insert(normalized);
    if (sErr) throw new Error(`supabase debate_steps insert failed: ${sErr.message}`);
  }
}
