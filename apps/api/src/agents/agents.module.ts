import { Global, Module } from '@nestjs/common';
import { anthropicProvider } from './llm/anthropic.provider';
import { geminiProvider } from './llm/gemini.provider';

// Shared agent primitives. Global so any feature module can inject the LLM
// clients via @Inject(GEMINI_LLM) / @Inject(ANTHROPIC_LLM) without re-importing.
@Global()
@Module({
  providers: [geminiProvider, anthropicProvider],
  exports: [geminiProvider, anthropicProvider],
})
export class AgentsModule {}
