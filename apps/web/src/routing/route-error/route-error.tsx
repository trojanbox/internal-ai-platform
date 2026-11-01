import { useTranslation } from '@repo/i18n'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'

import styles from './route-error.module.css'

export function RouteErrorPage() {
  const { t } = useTranslation('common')
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : t('routeError.title')

  return (
    <main className={styles.page}>
      <h1>{message}</h1>
      <Link className={styles.back} to="/items">
        {t('routeError.back')}
      </Link>
    </main>
  )
}
