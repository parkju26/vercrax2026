// D:\AGENT\VERCRAX\backend\src\services\hashChain.js
import crypto from "crypto";

/**
 * Hash Chain (Integrity)
 * - Each step hash links to prev_hash + step_payload
 * - chain_head_hash is the final hash
 */
export function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function buildHashChain() {
  const chain = [];
  let prev = "GENESIS";

  function addStep(step_type, payload) {
    const ts = new Date().toISOString();
    const body = {
      step_type,
      ts,
      prev_hash: prev,
      payload,
    };
    const step_hash = sha256(JSON.stringify(body));
    const record = { ...body, step_hash };
    chain.push(record);
    prev = step_hash;
    return record;
  }

  function head() {
    return prev;
  }

  return { addStep, head, chain };
}
