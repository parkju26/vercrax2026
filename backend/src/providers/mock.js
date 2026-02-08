export async function mockLLM({ system, user, roleKey, error }) {
  // A deterministic-ish mock so UI can be tested without keys.
  const seed = simpleHash(system + "\n" + user + "\n" + (error || ""));
  const rnd = mulberry32(seed);

  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const conf = Math.round((0.35 + rnd() * 0.45) * 100) / 100;

  if (roleKey === "verdict") {
    const label = pick(["BUY", "HOLD", "SELL", "UNCERTAIN"]);
    return JSON.stringify({
      label,
      confidence: conf,
      one_liner: `(${label}) 키가 없어서 mock 판단입니다. 실제 연결 시 토론 품질이 바뀝니다.`,
      why: [
        "데이터가 부족하므로 핵심 전제를 확인해야 함",
        "4개 관점이 일부 충돌함",
        "리스크 대비 기대수익이 불명확함"
      ],
      what_would_change_mind: ["티커/현재가/기간", "재무지표/가이던스", "최근 촉매(실적/규제/계약)"],
      engine_disagreements: ["상승 촉매의 확률 vs 하방 리스크 크기", "대안 대비 상대매력"]
    });
  }

  if (roleKey === "arena") {
    // Return a generic question/answer/judge JSON depending on the requested schema
    // Check for question schema (more robust matching)
    if (system.includes('"question"') || system.includes("question") || system.includes("질문")) {
      return JSON.stringify({
        question: "핵심 전제(수요/마진/금리) 중 무엇이 가장 취약하며, 이를 수치로 검증했나?",
        attack_type: "numbers",
        why_this_matters: "전제가 틀리면 결론이 반대로 뒤집힘"
      });
    }
    // Check for answer schema
    if (system.includes('"answer"') || system.includes("answer") || system.includes("답변")) {
      return JSON.stringify({
        answer: "현재는 정량 데이터가 부족하다. 다만 민감도 관점에서 수요 -10% 시 손익분기 붕괴 가능성을 가정한다.",
        evidence: ["가정 기반", "추가 데이터 필요"],
        numbers: [{ metric: "demand_change", value: "-10%", range: "-5%~-20%" }],
        concede: rnd() < 0.25,
        concede_reason: rnd() < 0.25 ? "수치 근거 부족을 인정" : ""
      });
    }
    // Check for judge/delta schema (default to judge)
    if (system.includes('"delta"') || system.includes("delta") || system.includes("판정") || system.includes("심판")) {
      const ko = rnd() < 0.1;
      return JSON.stringify({
        delta: { challenger: 2, defender: -1 },
        ko,
        ko_reason: ko ? "질문에 대한 수치 근거를 끝내 제시하지 못함" : "",
        why: ["질문이 전제 약점을 정확히 찌름", "답변의 수치 근거가 약함"],
        loser_fail_type: "no_numbers"
      });
    }
    // Fallback: assume judge if nothing matches
    const ko = rnd() < 0.1;
    return JSON.stringify({
      delta: { challenger: 1, defender: -1 },
      ko,
      ko_reason: ko ? "질문에 대한 수치 근거를 끝내 제시하지 못함" : "",
      why: ["기본 판정"],
      loser_fail_type: "none"
    });
  }

  // role engine output
  return JSON.stringify({
    role: roleKey,
    claim: "키가 없어서 mock 출력입니다. 실제 연결 시 근거/수치가 강화됩니다.",
    assumptions: ["추가 데이터 미제공", "시장 조건은 변동 가능"],
    numbers: [{ metric: "unknown", value: "unknown", range: "unknown" }],
    reasoning: ["전제 확인 필요", "상방/하방 시나리오 모두 열려 있음", "대안 비교가 필요"],
    questions_to_others: ["가장 큰 하방 촉발 요인은?", "대안 대비 우위 근거는?"],
    confidence: conf
  });
}

function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
