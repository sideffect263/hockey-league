import { supabase } from './supabase'

/**
 * Venues (#4/#3). Public-readable list of courts; admins + league managers manage it
 * (RLS on the venues table). Game/change-request venue fields pick a name from here.
 */

/** Active venues for dropdowns. */
export async function getVenues() {
  const { data, error } = await supabase.from('venues').select('id,name,city,address,lat,lng').eq('is_active', true).order('name')
  if (error) return []
  return data || []
}

/** All venues (admin tab). */
export async function getAllVenues() {
  const { data, error } = await supabase.from('venues').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function createVenue(name, city = null) {
  const { error } = await supabase.from('venues').insert({ name: (name || '').trim(), city: city?.trim() || null })
  if (error) { if (error.code === '23505') throw new Error('venue-exists'); throw error }
}

export async function updateVenue(id, patch) {
  const { error } = await supabase.from('venues').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteVenue(id) {
  const { error } = await supabase.from('venues').delete().eq('id', id)
  if (error) throw error
}


export { parseMapPin, hasPin, googleMapsPinUrl, googleMapsDirectionsUrl, wazeNavigateUrl, osmEmbedUrl } from './mapPin'
