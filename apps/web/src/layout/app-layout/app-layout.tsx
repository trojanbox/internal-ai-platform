import type { UserDto } from '@repo/contracts'
import { useTranslation } from '@repo/i18n'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@repo/ui'
import { ChevronDown, LogOut, UserRound } from 'lucide-react'
import { Outlet, useFetcher, useLoaderData } from 'react-router-dom'

import styles from './app-layout.module.css'

export function AppLayout() {
  const { t: tCommon } = useTranslation('common')
  const { t: tAuthentication } = useTranslation('authentication')
  const { user } = useLoaderData() as { user: UserDto }
  const logout = useFetcher()

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <a className={styles.brand} href="/items">
          {tCommon('appName')}
        </a>

        <DropdownMenu>
          <Tooltip content={user.email}>
            <DropdownMenuTrigger asChild>
              <Button aria-label={tCommon('accountMenuLabel')} size="sm" variant="secondary">
                <UserRound aria-hidden="true" size={16} />
                <span className={styles.email}>{user.email}</span>
                <ChevronDown aria-hidden="true" size={14} />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{tAuthentication('account.title')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={logout.state !== 'idle'}
              onSelect={() => {
                logout.submit(null, { action: '/logout', method: 'post' })
              }}
            >
              <LogOut aria-hidden="true" />
              {tAuthentication('account.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
