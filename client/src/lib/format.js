export function money(value, { cents = false } = {}) {
  const amount = Number(value) || 0
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })}`
}

export function compact(value) {
  const amount = Number(value) || 0
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  if (Math.abs(amount) >= 1_000) return `$${Math.round(amount / 1_000)}k`
  return money(amount)
}

export function stamp(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function timeOnly(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function dayLabel(value) {
  if (!value) return 'Earlier'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Earlier'
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  const same = (a, b) => a.toDateString() === b.toDateString()
  if (same(date, today)) return 'Today'
  if (same(date, yesterday)) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export function clock(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}
