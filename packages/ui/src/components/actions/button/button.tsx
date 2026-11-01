import { forwardRef, type ButtonHTMLAttributes } from 'react'

import styles from './button.module.css'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className = '', variant = 'primary', size = 'md', type = 'button', ...props },
  ref,
) {
  const classes = [styles.root, styles[variant], styles[size], className].filter(Boolean).join(' ')
  return <button ref={ref} className={classes} type={type} {...props} />
})
