import { describe, it, expect } from 'vitest'
import { parseMapPin, osmEmbedUrl, hasPin } from './mapPin'

const near = (r, lat, lng) => {
  expect(r.error).toBeUndefined()
  expect(r.lat).toBeCloseTo(lat, 4)
  expect(r.lng).toBeCloseTo(lng, 4)
}

describe('parseMapPin', () => {
  it('plain lat, lng', () => {
    near(parseMapPin('32.8275, 35.0858'), 32.8275, 35.0858)
    near(parseMapPin(' 32.8275 35.0858 '), 32.8275, 35.0858)
    near(parseMapPin('32.8275,35.0858'), 32.8275, 35.0858)
  })
  it('google @lat,lng,zoom', () => {
    near(parseMapPin('https://www.google.com/maps/place/%D7%90%D7%95%D7%9C%D7%9D/@32.82,35.08,17z/data=!3m1'), 32.82, 35.08)
  })
  it('google !3d!4d place pin beats the @ viewport', () => {
    near(parseMapPin('https://www.google.com/maps/place/X/@32.80,35.00,15z/data=!4m6!3m5!1s0x0:0x0!8m2!3d32.8275!4d35.0858'), 32.8275, 35.0858)
  })
  it('google ?q= / query= / destination=', () => {
    near(parseMapPin('https://maps.google.com/?q=32.8,35.1'), 32.8, 35.1)
    near(parseMapPin('https://www.google.com/maps/search/?api=1&query=32.8%2C35.1'), 32.8, 35.1)
    near(parseMapPin('https://www.google.com/maps/dir/?api=1&destination=32.8,35.1'), 32.8, 35.1)
  })
  it('waze ll= and share geohash', () => {
    near(parseMapPin('https://waze.com/ul?ll=32.8375%2C35.0775&navigate=yes'), 32.8375, 35.0775)
    near(parseMapPin('https://www.waze.com/live-map/directions?to=ll.32.8,35.1&ll=32.8,35.1'), 32.8, 35.1)
    const r = parseMapPin('https://waze.com/ul/hsvbfy2hdn')
    expect(r.error).toBeUndefined()
    expect(Math.abs(r.lat - 32.8275)).toBeLessThan(0.001)
    expect(Math.abs(r.lng - 35.0858)).toBeLessThan(0.001)
  })
  it('short links are refused with short-link', () => {
    expect(parseMapPin('https://maps.app.goo.gl/AbCdEf123')).toEqual({ error: 'short-link' })
    expect(parseMapPin('https://goo.gl/maps/xyz')).toEqual({ error: 'short-link' })
  })
  it('junk / out of range', () => {
    expect(parseMapPin('')).toEqual({ error: 'empty' })
    expect(parseMapPin('קריית ביאליק')).toEqual({ error: 'unparsed' })
    expect(parseMapPin('95, 35')).toEqual({ error: 'range' })
  })
  it('helpers', () => {
    expect(hasPin({ lat: null, lng: null })).toBe(false)
    expect(hasPin({ lat: 32.8, lng: 35.1 })).toBe(true)
    expect(osmEmbedUrl({ lat: 32.8, lng: 35.1 })).toContain('marker=32.8,35.1')
  })
})
