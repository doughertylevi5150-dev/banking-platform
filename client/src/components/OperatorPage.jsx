import { useCallback, useEffect, useRef, useState } from 'react'
import { askOperator, fetchBrief, runOperatorAction } from '../api/operatorApi'

const OPENERS = [
  'What should I do first today?',
  'Where is every loan and grant right now?',
  'Which bots are not earning anything?',
  'What is my net for the last seven days?',
]

const TONE = {
  toggleBot: 'amber',
  recordMoney: 'green',
  logNote: 'blue',
  setFundingNote: 'blue',
  draftProposal: 'purple',
}

function Stamp({ mode }) {
  if (!mode) return null
  const label = mode === 'model' ? 'Live read' : mode === 'offline' ? 'Offline read' : mode
  return <span className={`op-stamp op-stamp-${mode === 'model' ? 'live' : 'safe'}`}>{label}</span>
}

export default function OperatorPage({ token, onJump }) {
  const [messages, setMessages] = useState([])
  const [brief, setBrief] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ran, setRan] = useState({})
  const endRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function open() {
      try {
        const data = await fetchBrief(token)
        if (cancelled) return
        setBrief(data.snapshot)
        setMessages([
          {
            id: 'brief',
            role: 'operator',
            mode: 'brief',
            text: data.reply,
            followups: OPENERS.slice(0, 3),
          },
        ])
      } catch (problem) {
        if (!cancelled) setError(problem.message)
      }
    }

    open()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, busy])

  const history = useCallback(
    () =>
      messages
        .filter((message) => message.id !== 'brief')
        .map((message) => ({ role: message.role, text: message.text })),
    [messages],
  )

  async function send(text) {
    const question = (text ?? input).trim()
    if (!question || busy) return

    setInput('')
    setError('')
    setBusy(true)

    const ownerId = `owner-${Date.now()}`
    setMessages((prev) => [...prev, { id: ownerId, role: 'owner', text: question }])

    try {
      const answer = await askOperator(token, question, history())
      setMessages((prev) => [
        ...prev,
        {
          id: `op-${Date.now()}`,
          role: 'operator',
          mode: answer.mode,
          text: answer.reply,
          actions: answer.actions || [],
          followups: answer.followups || [],
        },
      ])
      if (answer.snapshot) setBrief(answer.snapshot)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  async function run(action, messageId, index) {
    const key = `${messageId}-${index}`
    setRan((prev) => ({ ...prev, [key]: { state: 'busy' } }))
    try {
      const result = await runOperatorAction(token, action)
      setRan((prev) => ({ ...prev, [key]: { state: 'done', done: result.done } }))
      setMessages((prev) => [
        ...prev,
        { id: `done-${Date.now()}`, role: 'operator', mode: 'apply', text: result.done },
      ])
    } catch (problem) {
      setRan((prev) => ({ ...prev, [key]: { state: 'error', done: problem.message } }))
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  const stats = brief
    ? [
        { label: 'Bots running', value: `${brief.bots.running}/${brief.bots.total}` },
        { label: 'Net, 7 days', value: `$${brief.money_last_7_days.net.toFixed(2)}` },
        { label: 'Capital routes', value: String(brief.funding.count) },
        { label: 'Proposals waiting', value: String(brief.proposals_waiting) },
      ]
    : []

  return (
    <div className="page op-page">
      <div className="page-head">
        <div>
          <h2>Operator</h2>
          <p className="page-sub">
            The console&rsquo;s own intelligence. It reads the live swarm, money and funding before it answers, and
            nothing runs without your click.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="ghost-btn" onClick={() => onJump && onJump('console')}>
            Back to console
          </button>
        </div>
      </div>

      {stats.length > 0 && (
        <div className="op-stats">
          {stats.map((stat) => (
            <div className="op-stat" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="op-thread">
        {messages.map((message) => (
          <div className={`op-turn op-turn-${message.role}`} key={message.id}>
            <div className="op-who">
              {message.role === 'owner' ? 'You' : 'Operator'}
              <Stamp mode={message.mode} />
            </div>
            <div className="op-bubble">
              {message.text.split('\n').map((line, index) => (
                <p key={`${message.id}-${index}`}>{line || '\u00a0'}</p>
              ))}
            </div>

            {Array.isArray(message.actions) && message.actions.length > 0 && (
              <div className="op-actions">
                {message.actions.map((action, index) => {
                  const key = `${message.id}-${index}`
                  const state = ran[key]
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`op-action op-action-${TONE[action.type] || 'blue'}`}
                      disabled={Boolean(state)}
                      onClick={() => run(action, message.id, index)}
                    >
                      {state?.state === 'done' ? state.done : state?.state === 'busy' ? 'Working…' : action.label || action.type}
                    </button>
                  )
                })}
              </div>
            )}

            {Array.isArray(message.followups) && message.followups.length > 0 && (
              <div className="op-followups">
                {message.followups.map((followup) => (
                  <button key={followup} type="button" className="op-chip" onClick={() => send(followup)}>
                    {followup}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="op-turn op-turn-operator">
            <div className="op-who">Operator</div>
            <div className="op-bubble op-thinking">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {error && <p className="op-error">{error}</p>}

      <div className="op-composer">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Ask the Operator anything about the swarm, the money, or the funding desk…"
          aria-label="Ask the Operator"
        />
        <button type="button" className="primary-btn" onClick={() => send()} disabled={busy || !input.trim()}>
          {busy ? 'Thinking…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
