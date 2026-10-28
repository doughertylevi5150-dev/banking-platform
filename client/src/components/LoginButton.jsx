function LoginButton({
  label = 'Log in',
  onClick,
  variant = 'secondary',
  className = '',
}) {
  const buttonClass = variant === 'primary' ? 'primary-btn' : 'secondary-btn'

  return (
    <button
      type="button"
      className={`${buttonClass} login-btn ${className}`.trim()}
      onClick={onClick}
      aria-label="Log in to your account"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="4" y="10" width="16" height="10" rx="2.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
      <span className="login-btn-label">{label}</span>
    </button>
  )
}

export default LoginButton
