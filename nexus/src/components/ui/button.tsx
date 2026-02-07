import React from 'react'
import { cn } from '@/lib/utils'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

const VARIANT: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: 'bg-[var(--accent-color)] text-white hover:bg-[var(--accent-hover)]',
  secondary:
    'border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]',
  ghost: 'bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
  danger: 'bg-[var(--danger-color)] text-white hover:bg-[var(--danger-hover)]'
}

const SIZE: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base'
}

export function Button({ className, variant = 'default', size = 'md', ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'pointer-events-auto inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-rgb)/0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...props}
    />
  )
}
