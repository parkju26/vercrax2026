export async function callAnthropic({ system, user, signal }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  const url = "https://api.anthropic.com/v1/messages";
  const body = {
    model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
    max_tokens: 1200,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: user }]
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body),
    signal
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`anthropic_error ${r.status}: ${t}`);
  }

  const j = await r.json();
  // anthropic message content is an array of blocks
  const text = (j.content || [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  return text;
}
