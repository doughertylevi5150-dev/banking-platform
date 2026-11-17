import { useState } from 'react'
import { findProspects } from '../api/foundryApi'

const KINDS = [
  { id: 'carwash', label: 'Car washes' },
  { id: 'batting', label: 'Batting cages' },
  { id: 'petwash', label: 'Self-serve pet washes' },
  { id: 'parking', label: 'Unattended parking' },
  { id: 'laundromat', label: 'Laundromats' },
  { id: 'arcade', label: 'Arcades' },
]

/**
 * Prospector: real businesses that fit the Tap Card System, pulled live from
 * Google Places, busiest first, with a one-tap call, site and map.
 */
export default function ProspectsPage({ token, onJump }) {
  const [kind, setKind] = useState('carwash')
  const [near, setNear] = useState('San Diego, CA')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function search(event) {
    event?.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const next = await findProspects(token, kind, near.trim() || 'San Diego, CA')
      setResult(next)
      if (next.error) setError(next.error)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  function exportCsv() {
    const rows = [['Name', 'Address', 'Phone', 'Rating', 'Reviews', 'Website', 'Map']]
    for (const p of result?.places || []) rows.push([p.name, p.address, p.phone, p.rating, p.reviews, p.website, p.maps])
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `prospects-${kind}-${near.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const places = result?.places || []

  return (
    <section className="section page" id="prospects">
      <div className="page-head">
        <div>
          <span className="pill">Prospector</span>
          <h2>Find Tap Card customers</h2>
          <p className="page-sub">Real businesses that fit the station, pulled live from Google Places, busiest first.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="ghost-btn" onClick={() => onJump('store')}>
            Open the store
          </button>
          <button type="button" className="ghost-btn" onClick={() => onJump('console')}>
            Back to console
          </button>
        </div>
      </div>

      <form className="filter-row" onSubmit={search}>
        <select className="select-input" value={kind} onChange={(event) => setKind(event.target.value)}>
          {KINDS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <input
          className="login-input prospect-near"
          value={near}
          onChange={(event) => setNear(event.target.value)}
          placeholder="City or neighborhood"
          aria-label="Where to look"
        />
        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? 'Searching…' : 'Find prospects'}
        </button>
        {places.length > 0 && (
          <button type="button" className="secondary-btn" onClick={exportCsv}>
            Export CSV
          </button>
        )}
      </form>

      {error && <p className="foundry-error">{error}</p>}
      {result && !error && !places.length && <p className="foundry-empty">No open businesses matched that search.</p>}

      <div className="prospect-grid">
        {places.map((place) => (
          <article className="mini-card prospect-card" key={place.id}>
            <strong>{place.name}</strong>
            <span className="mini-label">{place.address}</span>
            <span className="prospect-meta">
              {place.rating ? `★ ${place.rating.toFixed(1)} · ${place.reviews.toLocaleString()} reviews` : 'No reviews yet'}
            </span>
            <div className="prospect-actions">
              {place.phone && (
                <a className="ghost-btn" href={`tel:${place.phone.replace(/[^0-9+]/g, '')}`}>
                  Call
                </a>
              )}
              {place.website && (
                <a className="ghost-btn" href={place.website} target="_blank" rel="noreferrer">
                  Site
                </a>
              )}
              {place.maps && (
                <a className="ghost-btn" href={place.maps} target="_blank" rel="noreferrer">
                  Map
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
