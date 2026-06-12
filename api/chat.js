const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQxb6WwT3Y-YWRE_I-pBbBrS89QDdTmOakIcHg0rJiWTJHiotE-ngmZiD4nYRFF6Gb4BW3IFwkVSzBo/pub?output=csv";

async function fetchFournisseurs() {
  const res = await fetch(SHEET_CSV_URL);
  const csv = await res.text();
  const lines = csv.split("\n").slice(1); // skip header

  return lines
    .filter(l => l.trim())
    .map(line => {
      const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/); // CSV split
      const nom       = (cols[0] || "").replace(/"/g, "").trim();
      const ville     = (cols[7] || "").replace(/"/g, "").trim();
      const site      = (cols[8] || "").replace(/"/g, "").trim();
      const materiaux = (cols[5] || "").replace(/"/g, "").trim();
      const conditions= (cols[9] || "").replace(/"/g, "").trim();
      if (!nom) return null;
      return `- ${nom} (${ville}) | Site: ${site} | Matériaux: ${materiaux}${conditions ? " | Conditions: " + conditions : ""}`;
    })
    .filter(Boolean)
    .join("\n");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, system } = req.body;

    // Charger les fournisseurs depuis le Google Sheet
    const fournisseurs = await fetchFournisseurs();

    // Injecter la liste dans le prompt
    const systemWithData = system + `\n\nLISTE DES FOURNISSEURS (source : Google Sheet mis à jour en temps réel) :\n${fournisseurs}`;

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

    const fullContents = [
      { role: "user", parts: [{ text: systemWithData }] },
      { role: "model", parts: [{ text: "Compris. Je suis prêt à rechercher des matériaux de réemploi BTP parmi ces fournisseurs." }] },
      ...contents
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent?key=${process.env.GOOGLE_API_KEY}`,
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
        content: [{ type: "text", text: `Erreur API : ${data.error.message}` }]
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
