// ADR 0029 §4.4 (the hedge flag) and §4.7 (performance claims, D-4) — the per-locale lexicons, AUTHORED here (the ADR
// names the English terms and leaves pt and es to M2). PURE: no I/O, no clock.
//
// HOW A TERM MATCHES. Both the lexicon and the text are folded first: NFKD, combining marks and format characters
// removed, lower-cased — so "não" matches "nao", "impresiones" matches "IMPRESIONES", and an invisible character inside
// a word cannot hide it. A term matches only as a WHOLE WORD (or whole phrase, its spaces matching any run of
// whitespace): "hope" matches "we hope to" but not "hopeful", "reach" matches "organic reach" but not "breach". Terms
// below are therefore written already folded (unaccented, lower case).
//
// WHICH LOCALES. An answer's language is not known: a Portuguese-speaking founder writes for an English-language
// business as often as not. Every check therefore runs against ALL THREE lexicons. For the hedge flag that costs only an
// extra flag (a flag is never a block); for the D-4 drop it errs toward dropping, which §4.7 prefers ("false positives
// are preferred to false negatives") — the founder can re-answer.

export type LexiconLocale = 'en' | 'pt' | 'es'

// §4.4 — words that hedge a statement: think / believe / probably / maybe / hope / aim / try to / plan to / want to,
// with the inflections a founder actually writes. A record whose SPAN hedges and whose TEXT does not reads as more
// certain than the founder was. Both persons are listed: the SPAN is first person ("acho que", "creo que") but the TEXT is a
// third-person restatement ("a empresa acha que", "la empresa cree que"), and a record that KEPT its hedge must not be
// flagged for saying it in the third person.
export const HEDGE_LEXICON: Readonly<Record<LexiconLocale, readonly string[]>> = {
  en: [
    'think', 'thinks', 'thinking', 'thought',
    'believe', 'believes', 'believing',
    'probably', 'maybe', 'perhaps', 'might',
    'hope', 'hopes', 'hoping',
    'aim', 'aims', 'aiming',
    'try to', 'tries to', 'trying to',
    'plan to', 'plans to', 'planning to',
    'want to', 'wants to', 'wanting to',
  ],
  pt: [
    'acho', 'achamos', 'acha', 'acham', 'penso', 'pensamos', 'pensa', 'pensam',
    'creio', 'cremos', 'acredito', 'acreditamos', 'acredita', 'acreditam',
    'provavelmente', 'talvez', 'possivelmente',
    'espero', 'esperamos', 'espera', 'esperam', 'esperanca',
    'pretendo', 'pretendemos', 'pretende', 'pretendem', 'tencionamos', 'tenciona',
    'quero', 'queremos', 'quer', 'querem',
    'tento', 'tentamos', 'tenta', 'tentam', 'procuramos', 'procura', 'procuram',
    'planeamos', 'planeia', 'planeiam', 'planejamos', 'planeja', 'planejam', 'visamos', 'visa', 'aspiramos', 'aspira', 'aspiram',
  ],
  es: [
    'creo', 'creemos', 'cree', 'creen', 'pienso', 'pensamos', 'piensa', 'piensan',
    'supongo', 'suponemos', 'supone', 'suponen',
    'probablemente', 'quiza', 'quizas', 'tal vez', 'posiblemente',
    'espero', 'esperamos', 'espera', 'esperan', 'esperanza',
    'pretendo', 'pretendemos', 'pretende', 'pretenden',
    'quiero', 'queremos', 'quiere', 'quieren',
    'intento', 'intentamos', 'intenta', 'intentan', 'tratamos de', 'trata de', 'tratan de',
    'planeamos', 'planea', 'planean', 'planificamos', 'planifica', 'planifican', 'aspiramos', 'aspira', 'aspiran', 'buscamos',
  ],
}

// §4.7 — words that speak of what PERFORMS: engagement, impressions, likes, reach, CTR, click-through, performs /
// performed, does best, viral. Jemip learns that from the founder's published results, never from an interview, so a
// brand or audience item that mentions it is dropped and counted. Bare "reach" and "likes" will occasionally drop a
// harmless record; that is the accepted false positive. (M2.8 security review added views / followers / shares / clicks /
// conversion rate: a lexicon can only ever be best-effort, and ratification still shows every span to a human.)
export const PERFORMANCE_LEXICON: Readonly<Record<LexiconLocale, readonly string[]>> = {
  en: [
    'views', 'followers', 'shares', 'conversion rate', 'clicks',
    'engagement', 'impressions', 'impression', 'likes', 'reach', 'ctr',
    'click-through', 'click through', 'clickthrough',
    'performs', 'performed', 'performing', 'does best', 'do best', 'viral',
  ],
  pt: [
    'visualizacoes', 'seguidores', 'partilhas', 'compartilhamentos', 'cliques', 'taxa de conversao',
    'engajamento', 'envolvimento', 'impressoes', 'impressao', 'curtidas', 'gostos', 'likes', 'alcance', 'ctr',
    'taxa de cliques', 'taxa de clique', 'viral',
    'performa', 'performam', 'performou', 'desempenho', 'funciona melhor', 'funcionam melhor', 'resulta melhor', 'resultam melhor',
  ],
  es: [
    'visualizaciones', 'seguidores', 'compartidos', 'tasa de conversion',
    'engagement', 'interaccion', 'interacciones', 'impresiones', 'impresion', 'me gusta', 'likes', 'alcance', 'ctr',
    'tasa de clics', 'tasa de clic', 'clics', 'viral',
    'rendimiento', 'rinde mejor', 'rinden mejor', 'funciona mejor', 'funcionan mejor',
  ],
}

// NFKD + drop combining marks and format characters + lower case. Deliberately the SAME folding for the terms and the text.
export function foldForLexicon(text: string): string {
  return text.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '').toLowerCase()
}

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compile(lexicon: Readonly<Record<LexiconLocale, readonly string[]>>): RegExp {
  const terms = Object.values(lexicon).flat().map(foldForLexicon)
  const alternation = [...new Set(terms)]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.split(/\s+/).map(escapeRegex).join('\\s+'))
    .join('|')
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'u')
}

const HEDGE_PATTERN = compile(HEDGE_LEXICON)
const PERFORMANCE_PATTERN = compile(PERFORMANCE_LEXICON)

/** True if the text contains a hedge term (any of en / pt / es). */
export function containsHedge(text: string): boolean {
  return HEDGE_PATTERN.test(foldForLexicon(text))
}

/**
 * §4.4: the "more certain than your answer" marker. The SPAN (what the founder wrote) hedges, the TEXT (the record) does
 * not. A FLAG, never a block — it changes what the ratifier is shown, not whether a record exists. Evidence text IS its
 * span, so it can never be flagged.
 */
export function isMoreCertainThanAnswer(span: string, text: string): boolean {
  return containsHedge(span) && !containsHedge(text)
}

/** §4.7: true if the text speaks of what performs (any of en / pt / es). */
export function mentionsPerformanceClaim(text: string): boolean {
  return PERFORMANCE_PATTERN.test(foldForLexicon(text))
}
