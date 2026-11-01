import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

import styles from './dialog.module.css'

export type DialogProps = {
  trigger: ReactElement
  title: string
  description?: string
  closeLabel: string
  children: ReactNode
}

export function Dialog({ trigger, title, description, closeLabel, children }: DialogProps) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.overlay} />
        <DialogPrimitive.Content className={styles.content}>
          <DialogPrimitive.Title className={styles.title}>{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className={styles.description}>
              {description}
            </DialogPrimitive.Description>
          ) : null}
          <div className={styles.body}>{children}</div>
          <DialogPrimitive.Close className={styles.close} aria-label={closeLabel}>
            <X aria-hidden="true" size={18} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
