import removeMd from 'remove-markdown';

// jsonb rejects the NUL escape ('NUL'); strip it from any string in a payload
// before persisting. NULs leak in from PDF/LLM-extracted text.
export const stripNuls = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replace(/\\u0000/g, '')) as T;

// The multimodal extractor sometimes reconstructs PDF content as Markdown
// (headings, bold, tables, bullets). Reviewers expect plain text matching the
// PDF, so run extracted text through a Markdown→plaintext pass before storing.
export const mdToPlain = (text: string): string =>
  text ? removeMd(text) : text;
