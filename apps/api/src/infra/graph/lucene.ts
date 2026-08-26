// Lucene reserved/special characters — stripped so raw user/document text can never
// throw a query-syntax error. ponytail: strip-not-escape is enough for a relevance
// search; we don't need exact-phrase semantics here.
const LUCENE_SPECIAL_CHARS = /[+\-!(){}[\]^"~*?:\\/&|]/g;

export function sanitizeLuceneQuery(text: string): string {
  return text.replace(LUCENE_SPECIAL_CHARS, ' ').trim();
}
