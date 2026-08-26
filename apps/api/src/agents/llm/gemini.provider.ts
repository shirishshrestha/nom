import { Provider } from '@nestjs/common';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { GEMINI_LLM } from './llm.tokens';

// Extraction model (architecture.md §5 — Classifier/Preprocessor/Extractor).
// A shallow thinking budget is on by default — extraction is mechanical, so it needs
// only light reasoning (kept below the adjudicator's budget). Gemini thinking composes
// with structured output natively (no tool_choice conflict). Set
// GEMINI_THINKING_BUDGET=0 to disable.
export const geminiProvider: Provider = {
  provide: GEMINI_LLM,
  // factory runs lazily — process.env is populated by the app's ConfigModule
  useFactory: (): ChatGoogleGenerativeAI => {
    const thinkingBudget = Number(process.env.GEMINI_THINKING_BUDGET ?? 1024);
    return new ChatGoogleGenerativeAI({
      model: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite',
      apiKey: process.env.GOOGLE_API_KEY,
      // Low temp so extraction is reproducible — a re-extract of the same doc
      // matches the first run (0.1 over 0 to avoid degenerate-output edge cases).
      temperature: 0,
      // Explicit output ceiling: verbatim-section output can be large, so make the
      // budget known and tunable. Truncation (finishReason MAX_TOKENS) is detected
      // downstream and surfaced as DocumentTooLargeError rather than a parse failure.
      maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 32768),
      ...(thinkingBudget > 0 ? { thinkingConfig: { thinkingBudget } } : {}),
    });
  },
};
