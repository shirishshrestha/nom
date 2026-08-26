import { Provider } from '@nestjs/common';
import { ChatAnthropic } from '@langchain/anthropic';
import { ANTHROPIC_LLM } from './llm.tokens';

// Adjudication / reasoning model (architecture.md §5 — Reconciler/Adjudicator).
// Extended thinking is OFF by default: under thinking, langchain can't force tool_choice,
// so structured output depends on the model electing to call the tool — Haiku often skips
// it and raises OutputParserException (only recovered via the extractor's retry, costing a
// slow round-trip). Set ANTHROPIC_THINKING_BUDGET>0 to re-enable; then Anthropic also
// requires temperature 1 and budget_tokens < maxTokens.
export const anthropicProvider: Provider = {
  provide: ANTHROPIC_LLM,
  // factory runs lazily — process.env is populated by the app's ConfigModule
  useFactory: (): ChatAnthropic => {
    const thinkingBudget = Number(process.env.ANTHROPIC_THINKING_BUDGET ?? 0);
    const thinkingEnabled = thinkingBudget > 0;
    // A full-invoice adjudication emits per-line reasoning for every line; 8192 truncates
    // a mid-size invoice's JSON → unparseable → the whole invoice falls back to unmatched.
    // 16384 doubles the headroom while staying under the SDK's non-streaming ceiling of
    // 21,333 (max_tokens above that forces streaming); you pay only for tokens generated.
    const maxTokens = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 16384);
    return new ChatAnthropic({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxTokens,
      // temp 1 is mandatory with thinking; otherwise low temp for reproducibility.
      temperature: thinkingEnabled ? 1 : 0,
      ...(thinkingEnabled
        ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } }
        : {}),
    });
  },
};
