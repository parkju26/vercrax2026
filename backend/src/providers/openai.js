export async function callOpenAI({ system, user, signal }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  // Uses OpenAI Responses API style endpoint if available; falls back to Chat Completions compatible path.
  // NOTE: You can swap to your preferred endpoint.
  const url = "https://api.openai.com/v1/chat/completions";

  const body = {
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`openai_error ${r.status}: ${t}`);
  }

  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? "";
}
