// Vercel serverless function. Receives a base64 timeslip photo from the
// client, asks Claude to read the numbers off it, and returns them as JSON.
// The Anthropic API key stays server-side — the browser never sees it.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";
const SCAN_FIELDS = ["dialIn", "rt", "sixty", "threeThirty", "eighth", "mph"];
const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function buildPrompt(laneLabel) {
  return `You are reading a drag strip timeslip photo. These slips print two lanes side by side, one column of numbers for the LEFT lane and one for the RIGHT lane, with a row of labels printed between the two columns. A typical layout looks like:

LEFT: 1234                          RIGHT: 5678
7.07  ---- DIAL IN ---- 7.01
.0028 ---- REACTION ---- .0747
1.5061 ---- 60 FT ---- 1.5201
4.4860 ---- 330 FT ---- 4.5588
7.1004 ---- 1/8 ET ---- 7.2201
89.16 ---- 1/8 MPH ---- 87.40

The value BEFORE each label belongs to the LEFT lane; the value AFTER each label belongs to the RIGHT lane.

Read ONLY the ${laneLabel} lane column and extract these six values:
- Dial In
- Reaction Time (RT)
- 60 FT
- 330 FT
- 1/8 ET
- 1/8 MPH

Rules:
- Return ONLY strict JSON, no prose, no markdown code fences, in exactly this shape:
{"dialIn": "7.07", "rt": "0.0028", "sixty": "1.5061", "threeThirty": "4.4860", "eighth": "7.1004", "mph": "89.16"}
- Use an empty string "" for any value you cannot confidently read. Never guess or hallucinate a number.
- If the reaction time is negative (a red light / foul start), keep the minus sign, e.g. "-0.020".
- Do not include any field other than the six listed above.`;
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Defensive fallback in case the model wraps the JSON in prose or fences
    // despite instructions not to.
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("Model response was not valid JSON");
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Scan feature isn't configured (missing ANTHROPIC_API_KEY)." });
    return;
  }

  const { image, mediaType, lane } = req.body || {};
  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "No image provided." });
    return;
  }
  const resolvedMediaType = SUPPORTED_MEDIA_TYPES.has(mediaType) ? mediaType : "image/jpeg";
  const laneLabel = lane === "Left" || lane === "Right" ? lane : "Right";

  try {
    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: resolvedMediaType, data: image },
              },
              { type: "text", text: buildPrompt(laneLabel) },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text().catch(() => "");
      res.status(502).json({ error: `Anthropic API error (${anthropicRes.status}): ${errBody.slice(0, 300)}` });
      return;
    }

    const data = await anthropicRes.json();
    const text = data?.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      res.status(502).json({ error: "No text in the model's response." });
      return;
    }

    let parsed;
    try {
      parsed = extractJson(text);
    } catch {
      res.status(502).json({ error: "Couldn't parse the model's response as JSON." });
      return;
    }

    const result = {};
    SCAN_FIELDS.forEach((key) => {
      result[key] = typeof parsed[key] === "string" ? parsed[key] : "";
    });

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Unexpected error scanning the timeslip." });
  }
}
