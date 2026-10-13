import { supabase } from './supabase'
import { fetchGameFormSources } from './gameForm/sources.js'

/**
 * The game-form export's data layer. The logic lives in lib/gameForm/report.js and
 * lib/gameForm/sources.js, free of the browser's Supabase client, because
 * api/game-form.js (the native apps' export) runs the very same code on the server —
 * a fix to the form made there reaches the web and both apps at once.
 */
export { guestEntries, resolveOfficials, defaultFormFields, buildReport, gameFormFilename } from './gameForm/report.js'

/** The extra reads the export needs beyond what the game page already holds. */
export function getGameFormSources(gameId) {
  return fetchGameFormSources(supabase, gameId)
}
