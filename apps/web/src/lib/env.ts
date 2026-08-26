import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

/**
 * Validates Vite client env at startup — a missing/malformed VITE_* throws
 * here instead of failing deep in a request. Import `env` instead of
 * import.meta.env.
 */
export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_API_URL: z.string().url(),
  },
  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
})
