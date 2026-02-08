"use client";

import { useMemo, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; text: string };

type StreamEvent =
  | { type: "start"; run_id: string }
  | { type: "engine_result"; role: string; result: any }
  | { type: "base_judgment"; base: any }
  | { type: "deep_judgment"; deep: any }
  | { type: "debate_step"; round: number; challenger: string; defender: string; phase: string; payload: any }
  | { type: "debate_final"; winner: string; score: any; why_one_liner: string; ko?: boolean; ko_reason?: string }
  | { type: "final"; summary: any }
  | { type: "persisted"; ok: boolean; reason?: string; judgmentSaved?: boolean; stepsSaved?: number; error?: string };

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", text: "Vercrax. 단일 결론 금지. 4엔진 싸움으로 판단 한계를 보여준다." }
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const ui = useMemo(() => {
    const lastBase = [...events].reverse().find((e) => e.type === "base_judgment") as any;
    const lastFinal = [...events].reverse().find((e) => e.type === "debate_final") as any;
    const lastPersisted = [...events].reverse().find((e) => e.type === "persisted") as any;
    const lastFinalEvent = [...events].reverse().find((e) => e.type === "final") as any;
    return { 
      lastBase: lastBase?.base, 
      lastFinal,
      lastPersisted,
      decisionHash: lastFinalEvent?.summary?.decision_hash
    };
  }, [events]);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  async function send() {
    const prompt = input.trim();
    if (!prompt || busy) return;

    setMessages((m) => [...m, { role: "user", text: prompt }]);
    setInput("");
    setBusy(true);
    setEvents([]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const r = await fetch(`${BACKEND}/api/judge?debug_user_id=d296c55f-beea-429e-ac58-5f12a19d12b3`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          mode: "deep",
          debate: "arena",
          provider_preference: null,
          stream: true
        }),
        signal: ac.signal
      });

      if (!r.ok || !r.body) {
        const t = await r.text();
        throw new Error(`HTTP ${r.status}: ${t}`);
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      const allEvents: StreamEvent[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // NDJSON split
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as StreamEvent;
            allEvents.push(evt);
            setEvents((e) => [...e, evt]);
            scrollToBottom();
          } catch (parseErr) {
            console.warn("Failed to parse event:", line, parseErr);
          }
        }
      }

      // Build summary from all collected events
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: buildAssistantSummary(allEvents)
        }
      ]);
    } catch (e: any) {
      // 무한 로딩 방지: Abort/에러 시 종료 메시지 표시
      if (ac.signal.aborted) {
        setMessages((m) => [...m, { role: "assistant", text: "중지됨(Abort). 사용자가 요청을 취소했습니다." }]);
      } else {
        const errorMsg = e?.message || String(e) || "알 수 없는 오류";
        setMessages((m) => [...m, { role: "assistant", text: `에러 발생: ${errorMsg}\n\n스트리밍이 중단되었습니다.` }]);
      }
    } finally {
      // 무한 로딩 방지: 항상 busy 상태 해제
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort("user_stop");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col p-4">
      <header className="mb-3 flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm">
        <div>
          <div className="text-lg font-semibold">Vercrax</div>
          <div className="text-sm text-neutral-600">4엔진 병렬 + Arena 토론 + 승패 판정 + 기록</div>
        </div>
        <div className="flex gap-2">
          <a className="text-sm text-neutral-600 underline" href="http://localhost:3000/health" target="_blank">backend health</a>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-2xl bg-white shadow-sm flex flex-col">
          <div className="border-b p-3 text-sm text-neutral-600">Chat</div>
          <div className="flex-1 overflow-auto p-3 space-y-3">
            {messages.map((m, idx) => (
              <div key={idx} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm " +
                  (m.role === "user" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-900")
                }>
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t p-3 flex gap-2">
            <input
              className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
              placeholder="예: 솔리드파워 추가매수? 내 현금 1억, 12개월, 손실 크게 못봄."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={busy}
            />
            <button
              className="rounded-xl bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              onClick={send}
              disabled={busy}
            >
              {busy ? "진행중" : "보내기"}
            </button>
            <button
              className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50"
              onClick={stop}
              disabled={!busy}
              title="Stop (AbortController)"
            >
              Stop
            </button>
          </div>
        </section>

        <aside className="rounded-2xl bg-white shadow-sm flex flex-col">
          <div className="border-b p-3 text-sm text-neutral-600">Arena Timeline</div>
          <div ref={logRef} className="flex-1 overflow-auto p-3 space-y-2">
            {events.map((e, idx) => (
              <EventCard key={idx} e={e} />
            ))}
          </div>

          <div className="border-t p-3 space-y-2">
            <div className="text-xs text-neutral-500">BASE</div>
            <pre className="max-h-40 overflow-auto rounded-xl bg-neutral-50 p-2 text-xs">
{ui.lastBase ? JSON.stringify(ui.lastBase, null, 2) : "—"}
            </pre>

            <div className="text-xs text-neutral-500">Winner</div>
            <div className="rounded-xl bg-neutral-50 p-2 text-sm">
              {ui.lastFinal ? (
                <div>
                  <div className="font-semibold">{ui.lastFinal.winner}</div>
                  <div className="text-xs text-neutral-600">{ui.lastFinal.why_one_liner}</div>
                  {ui.lastFinal.ko ? <div className="mt-1 text-xs text-red-600">KO: {ui.lastFinal.ko_reason}</div> : null}
                </div>
              ) : "—"}
            </div>

            {ui.lastPersisted && (
              <>
                <div className="text-xs text-neutral-500">Persistence</div>
                <div className="rounded-xl bg-neutral-50 p-2 text-xs">
                  {ui.lastPersisted.ok ? (
                    <div className="text-green-600">
                      ✓ 저장 완료
                      {ui.lastPersisted.judgmentSaved && <div>Judgment: ✓</div>}
                      {ui.lastPersisted.stepsSaved !== undefined && ui.lastPersisted.stepsSaved > 0 && (
                        <div>Steps: {ui.lastPersisted.stepsSaved}</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-yellow-600">
                      ⚠ 저장 실패
                      <div className="text-xs">{ui.lastPersisted.reason || ui.lastPersisted.error || "알 수 없음"}</div>
                    </div>
                  )}
                </div>
              </>
            )}

            {ui.decisionHash && (
              <>
                <div className="text-xs text-neutral-500">Decision Hash</div>
                <div className="rounded-xl bg-neutral-50 p-2 text-xs font-mono break-all">
                  {ui.decisionHash.substring(0, 16)}...
                </div>
              </>
            )}
          </div>
        </aside>
      </main>

      <footer className="mt-4 text-xs text-neutral-500">
        팁: 공급자 키가 없으면 mock 엔진으로도 UI/흐름을 끝까지 테스트 가능.
      </footer>
    </div>
  );
}

function EventCard({ e }: { e: StreamEvent }) {
  if (e.type === "debate_step") {
    return (
      <div className="rounded-xl border p-2">
        <div className="text-xs text-neutral-500">R{e.round} {e.phase} · {e.challenger} → {e.defender}</div>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(e.payload, null, 2)}</pre>
      </div>
    );
  }

  if (e.type === "engine_result") {
    return (
      <div className="rounded-xl border p-2">
        <div className="text-xs text-neutral-500">engine · {e.role}</div>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(e.result, null, 2)}</pre>
      </div>
    );
  }

  if (e.type === "persisted") {
    return (
      <div className="rounded-xl border p-2">
        <div className="text-xs text-neutral-500">
          persisted · {e.ok ? "✓" : "✗"} {e.reason || ""}
        </div>
        {e.error && (
          <div className="mt-1 text-xs text-red-600">{e.error}</div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-2">
      <div className="text-xs text-neutral-500">{e.type}</div>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(e as any, null, 2)}</pre>
    </div>
  );
}

function buildAssistantSummary(events: StreamEvent[]) {
  const base = [...events].reverse().find((e: any) => e.type === "base_judgment") as any;
  const final = [...events].reverse().find((e: any) => e.type === "debate_final") as any;

  const label = base?.base?.label ?? "—";
  const conf = base?.base?.confidence ?? "—";
  const one = base?.base?.one_liner ?? "";
  const winner = final?.winner ?? "—";

  return [
    `BASE: ${label} (conf=${conf})`,
    one ? `한줄: ${one}` : "",
    `Arena Winner: ${winner}`,
    final?.ko ? `KO 사유: ${final.ko_reason}` : "",
    "",
    "※ 사이드패널에 라운드 타임라인/점수 변화가 기록됨."
  ].filter(Boolean).join("\n");
}
