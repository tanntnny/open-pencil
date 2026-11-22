import { config } from 'zod'

// Schemas validate without compiling code: a host's content policy may refuse eval, and Zod's
// probe for it would be reported as a violation on every load. Imported first, before any module
// that validates as it loads.
config({ jitless: true })
