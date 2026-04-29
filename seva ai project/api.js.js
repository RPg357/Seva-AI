module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }

  const body = typeof req.body === "string" ? safeParseJson(req.body) : req.body || {};
  const userMessage = normalizeUserMessage(body);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const intent = typeof body.intent === "string" ? body.intent : "General Query";
  const language = typeof body.language === "string" ? body.language : "en-IN";
  const user = body.user && typeof body.user === "object" ? body.user : {};

  if (!userMessage) {
    return res.status(400).json({ error: "Missing message" });
  }

  const systemPrompt = [
    "You are Seva AI, a helpful civic services assistant for India.",
    "Give concise, accurate, practical guidance.",
    "If the user asks about a government form, document, status check, or welfare scheme, explain the common steps and note that requirements can vary by state.",
    "Do not invent official rules. If details are unclear, ask for the user's state, district, and service name.",
    `Current intent: ${intent}.`,
    `Current language: ${language}.`,
    user.name ? `User name: ${user.name}.` : "",
  ].filter(Boolean).join(" ");

  const recentTranscript = messages
    .filter((m) => m && typeof m.content === "string" && typeof m.role === "string")
    .slice(-12)
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n");

  const prompt = [
    systemPrompt,
    recentTranscript ? `Conversation so far:\n${recentTranscript}` : "",
    `User: ${userMessage}`,
    "Assistant:",
  ].filter(Boolean).join("\n\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        input: prompt,
      }),
    });

    const raw = await response.text();
    const data = raw ? safeParseJson(raw) : {};

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || data?.error || raw || "OpenAI request failed",
      });
    }

    const reply = extractReply(data);
    return res.status(200).json({
      reply: reply || "I could not generate a response.",
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Unexpected server error",
    });
  }
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeUserMessage(body) {
  if (typeof body?.message === "string") return body.message.trim();
  if (typeof body?.input === "string") return body.input.trim();
  if (Array.isArray(body?.messages)) {
    const lastUser = [...body.messages].reverse().find((m) => m && m.role === "user" && typeof m.content === "string");
    return lastUser ? lastUser.content.trim() : "";
  }
  return "";
}

function extractReply(data) {
  if (!data || typeof data !== "object") return "";

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
      if (typeof part?.content === "string" && part.content.trim()) {
        return part.content.trim();
      }
    }
  }

  return "";
}
