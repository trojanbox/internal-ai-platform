import type { ApiListData, ItemListItemDto } from '@repo/contracts'
import { useTranslation } from '@repo/i18n'
import { Button, Dialog } from '@repo/ui'
import { CircleHelp } from 'lucide-react'
import { Link, useLoaderData } from 'react-router-dom'

import { ItemList } from '../../components/item-list/item-list'
import styles from './items.page.module.css'

export function ItemsPage() {
  const { t } = useTranslation('items')
  const { t: tCommon } = useTranslation('common')
  const { items } = useLoaderData() as { items: ApiListData<ItemListItemDto> }
  const { list, page } = items
  const prevPage = page.currentPage - 1
  const hasNext = page.currentPage * page.pageSize < page.totalRows

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>{t('eyebrow')}</div>
          <h1>{t('title')}</h1>
          <p>{t('description')}</p>
        </div>

        <Dialog
          trigger={
            <Button variant="secondary">
              <CircleHelp aria-hidden="true" size={16} />
              {t('template.trigger')}
            </Button>
          }
          title={t('template.title')}
          description={t('template.description')}
          closeLabel={tCommon('close')}
        >
          <p>
            {t('template.bodyBeforePackage')} <code>@repo/ui</code> {t('template.bodyAfterPackage')}
          </p>
        </Dialog>
      </header>

      {list.length > 0 ? <ItemList items={list} /> : <p>{t('empty')}</p>}
      <nav className={styles.pagination} aria-label={t('pagination.label')}>
        <span>{t('pagination.status', { page: page.currentPage, total: page.totalRows })}</span>
        <div className={styles.paginationControls}>
          {prevPage >= 1 ? (
            <Link to={'?currentPage=' + prevPage + '&pageSize=' + page.pageSize}>
              {t('pagination.previous')}
            </Link>
          ) : (
            <span aria-disabled="true">{t('pagination.previous')}</span>
          )}
          {hasNext ? (
            <Link to={'?currentPage=' + (page.currentPage + 1) + '&pageSize=' + page.pageSize}>
              {t('pagination.next')}
            </Link>
          ) : (
            <span aria-disabled="true">{t('pagination.next')}</span>
          )}
        </div>
      </nav>
    </section>
  )
}
