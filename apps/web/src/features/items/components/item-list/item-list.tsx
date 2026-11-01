import type { ItemListItemDto } from '@repo/contracts'
import { formatDate, useTranslation } from '@repo/i18n'
import { Link } from 'react-router-dom'

import styles from './item-list.module.css'

type ItemListProps = { items: ItemListItemDto[] }

export function ItemList({ items }: ItemListProps) {
  const { t, i18n } = useTranslation('items')

  return (
    <div className={styles.grid}>
      {items.map((item) => (
        <Link className={styles.card} key={item.id} to={`/items/${item.id}`}>
          <div className={styles.date}>{formatDate(item.createdAt, i18n.resolvedLanguage)}</div>
          <h2>{item.title}</h2>
          <p>{item.summary}</p>
          <span>{t('viewDetail')}</span>
        </Link>
      ))}
    </div>
  )
}
