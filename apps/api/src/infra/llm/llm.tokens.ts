// DI tokens for the provider-agnostic structured-extraction layer.
export const STRUCTURED_EXTRACTOR = Symbol('STRUCTURED_EXTRACTOR'); // Gemini — extraction
export const ADJUDICATOR_EXTRACTOR = Symbol('ADJUDICATOR_EXTRACTOR'); // Anthropic/Haiku — reconcile/adjudicate
export const EXTRACTOR_CONFIG = Symbol('EXTRACTOR_CONFIG');
