import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'

import styles from './dropdown-menu.module.css'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export function DropdownMenuContent(props: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={6}
        {...props}
        className={[styles.content, props.className].filter(Boolean).join(' ')}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuItem(props: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      {...props}
      className={[styles.item, props.className].filter(Boolean).join(' ')}
    />
  )
}

export function DropdownMenuLabel(props: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      {...props}
      className={[styles.label, props.className].filter(Boolean).join(' ')}
    />
  )
}

export function DropdownMenuSeparator(
  props: ComponentProps<typeof DropdownMenuPrimitive.Separator>,
) {
  return (
    <DropdownMenuPrimitive.Separator
      {...props}
      className={[styles.separator, props.className].filter(Boolean).join(' ')}
    />
  )
}
