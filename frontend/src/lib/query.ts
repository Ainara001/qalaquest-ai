// Fragments that make a search-box query a request to the AI guide rather than the name of a place (RU / KK / EN).
// The query is padded with spaces, so a leading/trailing space marks a word boundary (" час " ≠ "Часовня").
const AI_MARKERS = [
  // ru
  "хочу", "хотим", "хотелось", " где ", " куда ", " что ", " как ", "посоветуй", "подскажи", "подбери", "предложи",
  "найди мне", "погулять", "прогулк", "сходить", "отдохнуть", " минут", " час ", " часа", " часов", "полчаса", "бесплатн",
  "недорог", "с ребен", "с ребён", "с детьми", "спокойн", " тих", "романт", "красив", "необычн", "интересн", "поесть",
  "выпить кофе", "рядом со мной", "недалеко", "для фото",
  // kk
  "қайда", "қалай", "келеді", "серуенде", "жақын", "тегін", "балалар", "ұсын", "көрсет", " сағат", "демал", "әдемі", "қызықты",
  // en
  " want", " where", "something", " walk", "near me", " minutes", " hour", " free ", " quiet", "with kids",
];

/**
 * Heuristic: does this text look like a request for the AI ("хочу спокойно погулять около часа") or like a place
 * name ("Ботанический сад")? Names go to the database search only, so ordinary lookups never cost an LLM call.
 * The user can always pick the other option explicitly in the search panel.
 */
export function looksLikeAiQuery(text: string): boolean {
  const q = ` ${text.trim().toLowerCase().replace(/\s+/g, " ")} `;
  if (q.trim().length < 3) return false;
  if (q.includes("?")) return true;
  if (q.trim().split(" ").length >= 5) return true;
  return AI_MARKERS.some((m) => q.includes(m));
}
