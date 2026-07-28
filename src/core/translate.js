// Translates the exported tech pack's Spanish source fields into EN/ZH for
// the wizard's own "Idioma" export step. Used to be a direct Anthropic call
// (claudeApi.js) needing its own VITE_ANTHROPIC_API_KEY nobody had
// configured - now routed through the same hybrid transport every other AI
// task uses (NVIDIA on the public build, Mistral/Qwen on studio), no
// separate key required. Kept resilient on purpose: a translation failure
// degrades to the untranslated Spanish object rather than blocking export -
// unlike the Wilcom PDF path (embExtract.js), an incomplete translation is
// a reasonable degraded result, not a silent lie about what happened.
import { extractStructured } from "./deepseekClient.js"

export async function translateContent(hdr, parts, designs, targetLang) {
  const langName = targetLang === "EN" ? "English" : "Mandarin Chinese"
  const obj = {
    pname: hdr.pname,
    parts: parts.filter((p) => p.on).map((p) => p.val),
    designs: designs.map((d) => ({ name: d.name, posDetail: d.posDetail || "" })),
  }
  try {
    const result = await extractStructured({
      instructions:
        "Translate fashion apparel tech pack fields from Spanish to " + langName + ". Return ONLY valid JSON same keys. Do NOT translate brand names, codes, or numbers.",
      content: JSON.stringify(obj),
      maxTokens: 800,
    })
    return result && typeof result === "object" ? result : obj
  } catch {
    return obj
  }
}
