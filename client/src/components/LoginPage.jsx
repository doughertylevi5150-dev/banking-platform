import { useRef, useState } from 'react'
import PushButton from './PushButton'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function validateField(name, value) {
  if (name === 'name' && !value.trim()) return 'Enter your name.'
  if (name === 'setupKey' && !value.trim()) return 'Enter the setup key.'

  if (name === 'email') {
    if (!value.trim()) return 'Enter your email address.'
    if (!EMAIL_PATTERN.test(value.trim())) return 'That email address looks incomplete.'
  }

  if (name === 'password') {
    if (!value) return 'Enter your password.'
    if (value.length < 8) return 'Passwords are at least 8 characters.'
  }

  return ''
}

function LoginPage({ onSignIn, onClaimOwner, setupRequired, busy, error, fieldErrors = {} }) {
  const [values, setValues] = useState({ name: '', email: '', password: '', setupKey: '' })
  const [errors, setErrors] = useState({})
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)

  const emailRef = useRef(null)
  const passwordRef = useRef(null)
  const nameRef = useRef(null)
  const setupKeyRef = useRef(null)

  const fields = setupRequired
    ? ['name', 'setupKey', 'email', 'password']
    : ['email', 'password']

  function handleChange(event) {
    const { name, value } = event.target
    setValues((current) => ({ ...current, [name]: value }))

    if (errors[name]) {
      setErrors((current) => ({ ...current, [name]: validateField(name, value) }))
    }
  }

  function handleBlur(event) {
    const { name, value } = event.target
    setErrors((current) => ({ ...current, [name]: validateField(name, value) }))
  }

  function handleSubmit(event) {
    event.preventDefault()

    const nextErrors = {}
    for (const field of fields) {
      const message = validateField(field, values[field])
      if (message) nextErrors[field] = message
    }

    setErrors(nextErrors)

    if (nextErrors.name) return nameRef.current?.focus()
    if (nextErrors.setupKey) return setupKeyRef.current?.focus()
    if (nextErrors.email) return emailRef.current?.focus()
    if (nextErrors.password) return passwordRef.current?.focus()

    if (setupRequired) {
      onClaimOwner?.({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
        setupKey: values.setupKey.trim(),
      })
      return
    }

    onSignIn?.(values.email.trim(), values.password, remember)
  }

  function fieldError(name) {
    return errors[name] || fieldErrors[name] || ''
  }

  const emailInvalid = Boolean(fieldError('email'))
  const passwordInvalid = Boolean(fieldError('password'))
  const nameInvalid = Boolean(fieldError('name'))
  const setupKeyInvalid = Boolean(fieldError('setupKey'))

  return (
    <div className="auth-shell">
      <div className="login-card auth-card">
        <div className="brand-wrap auth-brand">
          <div className="brand-mark">LU</div>
          <div>
            <div className="brand-name">LevisBotUniverse</div>
            <div className="brand-tag">Autonomous banking operations</div>
          </div>
        </div>

        <div className="auth-head">
          <h1>{setupRequired ? 'Claim this console' : 'Sign in'}</h1>
          <p>
            {setupRequired
              ? 'One-time owner setup. The door closes behind you.'
              : 'Owner access only. Nothing here is shared.'}
          </p>
        </div>

        <span className="bot-badge green">
          {setupRequired ? 'Locked until claimed' : 'Owner access only'}
        </span>

        {error && (
          <p className="auth-error" role="alert">
            <span className="dot" />
            {error}
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {setupRequired && (
            <div className={`login-field${nameInvalid ? ' has-error' : ''}`}>
              <label htmlFor="login-name">Your name</label>
              <input
                id="login-name"
                ref={nameRef}
                className="login-input"
                type="text"
                name="name"
                autoComplete="name"
                placeholder="Levi Dougherty"
                value={values.name}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={nameInvalid}
                aria-describedby={nameInvalid ? 'login-name-error' : undefined}
              />
              {nameInvalid && (
                <p className="login-error" id="login-name-error" role="alert">
                  <span className="dot" />
                  {fieldError('name')}
                </p>
              )}
            </div>
          )}

          <div className={`login-field${emailInvalid ? ' has-error' : ''}`}>
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              ref={emailRef}
              className="login-input"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@bank.com"
              value={values.email}
              onChange={handleChange}
              onBlur={handleBlur}
              aria-invalid={emailInvalid}
              aria-describedby={emailInvalid ? 'login-email-error' : undefined}
            />
            {emailInvalid && (
              <p className="login-error" id="login-email-error" role="alert">
                <span className="dot" />
                {fieldError('email')}
              </p>
            )}
          </div>

          <div className={`login-field${passwordInvalid ? ' has-error' : ''}`}>
            <label htmlFor="login-password">Password</label>
            <div className="login-field-input">
              <input
                id="login-password"
                ref={passwordRef}
                className="login-input"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete={setupRequired ? 'new-password' : 'current-password'}
                placeholder="At least 8 characters"
                value={values.password}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={passwordInvalid}
                aria-describedby={passwordInvalid ? 'login-password-error' : undefined}
              />
              <button
                type="button"
                className="login-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-pressed={showPassword}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {passwordInvalid && (
              <p className="login-error" id="login-password-error" role="alert">
                <span className="dot" />
                {fieldError('password')}
              </p>
            )}
          </div>

          {setupRequired && (
            <div className={`login-field${setupKeyInvalid ? ' has-error' : ''}`}>
              <label htmlFor="login-setup-key">Setup key</label>
              <input
                id="login-setup-key"
                ref={setupKeyRef}
                className="login-input"
                type="password"
                name="setupKey"
                autoComplete="off"
                placeholder="From your deployment settings"
                value={values.setupKey}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={setupKeyInvalid}
                aria-describedby={setupKeyInvalid ? 'login-setup-key-error' : undefined}
              />
              {setupKeyInvalid && (
                <p className="login-error" id="login-setup-key-error" role="alert">
                  <span className="dot" />
                  {fieldError('setupKey')}
                </p>
              )}
            </div>
          )}

          {!setupRequired && (
            <div className="login-row">
              <label className="login-check" htmlFor="login-remember">
                <input
                  id="login-remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                Keep me signed in
              </label>
            </div>
          )}

          <PushButton type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Checking…' : setupRequired ? 'Claim owner access' : 'Log in'}
          </PushButton>
        </form>

        <p className="auth-footer">
          {setupRequired
            ? 'This console stays locked to whoever claims it first.'
            : 'No sign-up. Access is limited to the console owner.'}
        </p>
      </div>
    </div>
  )
}

export default LoginPage
