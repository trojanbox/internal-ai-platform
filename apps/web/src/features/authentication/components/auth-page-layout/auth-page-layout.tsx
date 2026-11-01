import { Button } from '@repo/ui'
import type { ReactNode } from 'react'
import { Form, Link } from 'react-router-dom'

import styles from './auth-page-layout.module.css'

type AuthPageLayoutProps = {
  appName: string
  title: string
  description: string
  submitLabel: string
  busy: boolean
  errorMessage?: string | undefined
  switchTo: string
  switchLabel: string
  children: ReactNode
}

export function AuthPageLayout({
  appName,
  title,
  description,
  submitLabel,
  busy,
  errorMessage,
  switchTo,
  switchLabel,
  children,
}: AuthPageLayoutProps) {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>{appName}</div>
        <h1>{title}</h1>
        <p className={styles.lead}>{description}</p>
        <Form method="post" className={styles.form}>
          {children}
          {errorMessage ? (
            <p className={styles.error} role="alert">
              {errorMessage}
            </p>
          ) : null}
          <Button aria-busy={busy} disabled={busy} type="submit">
            {submitLabel}
          </Button>
        </Form>
        <Link className={styles.switchLink} to={switchTo}>
          {switchLabel}
        </Link>
      </section>
    </main>
  )
}
