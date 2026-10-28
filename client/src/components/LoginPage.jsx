import { useRef, useState } from 'react'
import PushButton from './PushButton'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function validateField(name, value) {
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

function LoginPage({ onSignIn }) {
  const [values, setValues] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({ email: '', password: '' })
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)

  const emailRef = useRef(null)
  const passwordRef = useRef(null)

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

    const nextErrors = {
      email: validateField('email', values.email),
      password: validateField('password', values.password),
    }

    setErrors(nextErrors)

    if (nextErrors.email) {
      emailRef.current?.focus()
      return
    }

    if (nextErrors.password) {
      passwordRef.current?.focus()
      return
    }

    onSignIn?.(values.email.trim())
  }

  const emailInvalid = Boolean(errors.email)
  const passwordInvalid = Boolean(errors.password)

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
          <h1>Sign in</h1>
          <p>Pick up where your bots left off.</p>
        </div>

        <span className="bot-badge green">Secure sign-in</span>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
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
                {errors.email}
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
                autoComplete="current-password"
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
                {errors.password}
              </p>
            )}
          </div>

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
            <a className="login-link" href="#reset">
              Forgot password?
            </a>
          </div>

          <PushButton type="submit" className="auth-submit">
            Log in
          </PushButton>
        </form>

        <p className="auth-footer">
          New here? <a href="#access">Request console access</a>
        </p>
      </div>
    </div>
  )
}

export default LoginPage
