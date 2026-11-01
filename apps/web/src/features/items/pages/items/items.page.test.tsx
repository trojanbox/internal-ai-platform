import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ItemsPage } from './items.page'

describe('ItemsPage pagination', () => {
  it('exposes previous and next links from the actual totalRows metadata', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/items',
          element: <ItemsPage />,
          loader: () => ({
            items: {
              list: [],
              page: { currentPage: 2, pageSize: 10, totalRows: 21 },
            },
          }),
        },
      ],
      { initialEntries: ['/items?currentPage=2&pageSize=10'] },
    )
    render(<RouterProvider router={router} />)
    const previous = await screen.findByRole('link', { name: '上一页' })
    const next = screen.getByRole('link', { name: '下一页' })
    expect(previous).toHaveAttribute('href', '/items?currentPage=1&pageSize=10')
    expect(next).toHaveAttribute('href', '/items?currentPage=3&pageSize=10')
  })
})
