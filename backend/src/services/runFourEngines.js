import { runRole } from "./roles.js";

const ROLES = [
  { key: "probability", label: "Probability", instruction: "확률·전제·민감도 중심. 수치, 범위, 확률 분포로 말해라." },
  { key: "risk",        label: "Risk",        instruction: "리스크(Downside) 중심. 손실 시나리오, 촉발 요인, 헤지/손절을 제시해라." },
  { key: "structure",   label: "Structure",   instruction: "구조(사업/재무/시장/밸류에이션/촉매) 중심. 논리 구조로 분해해라." },
  { key: "opportunity", label: "Opportunity", instruction: "기회비용·대안·상대매력 중심. 같은 자본으로 더 나은 선택지를 비교해라." }
];

export async function runFourEngines({ prompt, providerPreference, signal, emit, logger }) {
  const tasks = ROLES.map(async (r) => {
    const out = await runRole({
      roleKey: r.key,
      roleLabel: r.label,
      instruction: r.instruction,
      prompt,
      providerPreference,
      signal
    });
    emit("engine_result", { role: r.key, provider: out.provider, result: out.result });
    return [r.key, out];
  });

  const pairs = await Promise.all(tasks);
  const engines = Object.fromEntries(pairs);

  logger?.info({ roles: Object.keys(engines) }, "4 engines done");
  return engines;
}
