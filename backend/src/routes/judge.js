import { runJudgmentPipeline } from "../services/pipeline.js";

export async function judgeHandler(req, res, logger) {
  const userId = req.userId || "anonymous";
  const {
    prompt,
    mode = "base",              // base | deep
    debate = "arena",           // arena | all | none
    provider_preference = null, // openai | anthropic | null
    stream = true
  } = req.body || {};

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt(string) is required" });
  }

  const wantStream = !!stream;

  const controller = new AbortController();

  // ✅ 핵심: close는 "정상 종료 후"에도 뜰 수 있음.
  // - 그래서 close에서 무조건 abort하면 오탐(client_disconnected)이 발생한다.
  // - aborted 이벤트(클라이언트가 진짜 요청을 중단) + "응답이 끝나기 전에 close"만 abort 처리.
  req.on("aborted", () => controller.abort("client_disconnected"));
  res.on("close", () => {
    // 응답이 아직 끝나지 않았는데 연결이 닫혔을 때만 중단
    if (!res.writableEnded) controller.abort("client_disconnected");
  });

  try {
    if (wantStream) {
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const write = (obj) => {
        if (res.writableEnded) return;
        try {
          res.write(JSON.stringify(obj) + "\n");
        } catch {
          controller.abort("client_disconnected");
        }
      };

      await runJudgmentPipeline({
        userId,
        requestId: req.requestId,
        prompt,
        mode,
        debate,
        providerPreference: provider_preference,
        signal: controller.signal,
        onEvent: write,
        logger
      });

      if (!res.writableEnded) res.end();
      return;
    }

    const result = await runJudgmentPipeline({
      userId,
      requestId: req.requestId,
      prompt,
      mode,
      debate,
      providerPreference: provider_preference,
      signal: controller.signal,
      onEvent: null,
      logger
    });

    return res.json(result);
  } catch (err) {
    const aborted = controller.signal.aborted;
    logger.warn({ err: String(err), aborted }, "judge failed");

    if (aborted) {
      if (!res.writableEnded) res.end();
      return;
    }

    return res.status(500).json({ error: "judge_failed", detail: String(err) });
  }
}
