import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ItemList } from './item-list'

describe('ItemList', () => {
  it('renders semantic links to item details', () => {
    render(
      <MemoryRouter>
        <ItemList
          items={[
            {
              id: '11111111-1111-4111-8111-111111111111',
              title: 'Template item',
              summary: 'Summary',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ]}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /Template item/ })).toHaveAttribute(
      'href',
      '/items/11111111-1111-4111-8111-111111111111',
    )
  })
})
