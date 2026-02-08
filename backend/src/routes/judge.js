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

  // Streaming is enabled by default (stream=true). For non-stream, set stream=false.
  const wantStream = !!stream;

  const controller = new AbortController();
  req.on("close", () => {
    // Client closed connection; stop work ASAP.
    controller.abort("client_disconnected");
  });

  try {
    if (wantStream) {
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const write = (obj) => {
        if (res.writableEnded) return;
        res.write(JSON.stringify(obj) + "\n");
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
      // No error: client disconnected, just stop.
      if (!res.writableEnded) res.end();
      return;
    }

    return res.status(500).json({ error: "judge_failed", detail: String(err) });
  }
}
