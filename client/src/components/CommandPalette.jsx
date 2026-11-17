import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchFoundry } from '../api/foundryApi'

/**
 * Ctrl/Cmd+K opens a palette that jumps to any page or bot and runs the
 * console's actions without hunting through the nav.
 */
function CommandPalette({ open, onClose, token, actions }) {
  const [query, setQuery] = useState('')
  const [bots, setBots] = useState([])
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    setQuery('')
    setCursor(0)
    const focus = window.setTimeout(() => inputRef.current?.focus(), 10)
    let alive = true
    fetchFoundry(token)
      .then((state) => {
        if (alive) setBots(state?.bots || [])
      })
      .catch(() => {})
    return () => {
      alive = false
      window.clearTimeout(focus)
    }
  }, [open, token])

  const items = useMemo(() => {
    const botItems = bots.map((bot) => ({
      id: `bot-${bot.slug}`,
      group: 'Bots',
      label: bot.name,
      hint: `${bot.status}${bot.estMonthly ? ` · $${Math.round(bot.estMonthly).toLocaleString()}/mo` : ''}`,
      run: () => actions.openBot(bot.slug),
    }))
    const all = [...actions.list, ...botItems]
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((item) => `${item.label} ${item.group} ${item.hint || ''}`.toLowerCase().includes(q))
  }, [actions, bots, query])

  useEffect(() => {
    if (cursor >= items.length) setCursor(Math.max(0, items.length - 1))
  }, [items, cursor])

  if (!open) return null

  function choose(item) {
    if (!item) return
    onClose()
    item.run()
  }

  function onKey(event) {
    if (event.key === 'Escape') onClose()
    else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => Math.min(items.length - 1, c + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(items[cursor])
    }
  }

  let lastGroup = ''
  return (
    <div className="cmdk-overlay" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Jump to a page, a bot, or an action…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setCursor(0)
          }}
          onKeyDown={onKey}
          aria-label="Search commands"
        />
        <ul className="cmdk-list" role="listbox">
          {items.length === 0 && <li className="cmdk-empty">Nothing matches “{query}”.</li>}
          {items.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : ''
            lastGroup = item.group
            return (
              <li key={item.id}>
                {header && <div className="cmdk-group">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className={`cmdk-item${index === cursor ? ' is-active' : ''}`}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => choose(item)}
                >
                  <span>{item.label}</span>
                  {item.hint && <span className="cmdk-hint">{item.hint}</span>}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="cmdk-foot">↑↓ to move · Enter to run · Esc to close</div>
      </div>
    </div>
  )
}

export default CommandPalette
