export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, system } = req.body;

    // Convertir le format Anthropic → format Google
    const contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string"
        ? m.content
        : (Array.isArray(m.content)
            ? m.content.filter(b => b.type === "text").map(b => b.text).join("\n")
            : String(m.content))
      }]
    }));

    // Gemma 4 ne supporte pas google_search ni system_instruction
    // On injecte le prompt système comme premier message user
    const fullContents = [
      { role: "user", parts: [{ text: system }] },
      { role: "model", parts: [{ text: "Compris. Je suis prêt à rechercher des matériaux de réemploi BTP." }] },
      ...contents
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: fullContents,
          generationConfig: {
            maxOutputTokens: 4000,
            temperature: 0.7,
          }
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(200).json({
        content: [{ type: "text", text: `Erreur Google API : ${data.error.message}` }]
      });
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.filter(p => p.text)
      ?.map(p => p.text)
      ?.join("\n") || "Désolé, aucune réponse reçue.";

    res.status(200).json({
      content: [{ type: "text", text: text }]
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
