function PushButton({
  children,
  variant = 'primary',
  className = '',
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      className={`push-btn push-btn-${variant} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  )
}

export default PushButton
