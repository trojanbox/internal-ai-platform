import type { ItemDetailDto } from '@repo/contracts'
import { useTranslation } from '@repo/i18n'
import { Link, useLoaderData } from 'react-router-dom'

import styles from './item-detail.page.module.css'

export function ItemDetailPage() {
  const { t } = useTranslation('items')
  const { item } = useLoaderData() as { item: ItemDetailDto }

  return (
    <article className={styles.article}>
      <Link className={styles.back} to="/items">
        ← {t('back')}
      </Link>
      <div className={styles.eyebrow}>{t('detail')}</div>
      <h1>{item.title}</h1>
      <p className={styles.summary}>{item.summary}</p>
      <div className={styles.content}>{item.content}</div>
    </article>
  )
}
