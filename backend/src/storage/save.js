import { getSupabaseAdmin } from "./supabaseAdmin.js";

export async function saveFullRun(final) {
  // Best-effort persistence. If Supabase env is not set, no-op.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, reason: "supabase_env_not_set", judgmentSaved: false, stepsSaved: 0 };
  }

  let judgmentSaved = false;
  let stepsSaved = 0;

  try {
    const supabase = getSupabaseAdmin();

    // 1) judgments
    const judgmentRow = {
      run_id: final.run_id,
      user_id: final.user_id,
      request_id: final.request_id,
      prompt: final.integrity.chain_steps.prompt,
      mode: final.mode,
      debate: final.debate,
      base_judgment: final.base_judgment,
      deep: final.deep,
      debate_result: final.debate_result ? {
        winner: final.debate_result.winner,
        loser: final.debate_result.loser,
        ko: final.debate_result.ko,
        ko_reason: final.debate_result.ko_reason,
        score: final.debate_result.score,
        why_one_liner: final.debate_result.why_one_liner
      } : null,
      decision_hash: final.integrity.decision_hash,
      created_at: final.finished_at
    };

    const { error: jErr, data: jData } = await supabase.from("judgments").upsert(judgmentRow, { onConflict: "run_id" });
    if (jErr) {
      throw new Error(`supabase judgments upsert failed: ${jErr.message}`);
    }
    judgmentSaved = true;

    // 2) debate steps
    let stepsSaved = 0;
    if (final.debate_result?.steps?.length) {
      const rows = final.debate_result.steps.map((s, idx) => ({
        run_id: final.run_id,
        idx,
        round: s.round,
        challenger: s.challenger,
        defender: s.defender,
        phase: s.phase,
        payload: s.payload
      }));

      // delete then insert (simple)
      const { error: dErr } = await supabase.from("debate_steps").delete().eq("run_id", final.run_id);
      if (dErr) {
        throw new Error(`supabase debate_steps delete failed: ${dErr.message}`);
      }

      const { error: sErr, data: sData } = await supabase.from("debate_steps").insert(rows);
      if (sErr) {
        throw new Error(`supabase debate_steps insert failed: ${sErr.message}`);
      }
      stepsSaved = rows.length;
    }

    return { ok: true, reason: "success", judgmentSaved, stepsSaved };
  } catch (err) {
    // Return error details instead of throwing, so pipeline can emit persisted event and continue
    return { 
      ok: false, 
      reason: "exception", 
      error: String(err), 
      judgmentSaved, 
      stepsSaved 
    };
  }
}
