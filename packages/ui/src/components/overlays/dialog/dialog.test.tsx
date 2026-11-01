import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Button } from '../../actions/button/button'
import { Dialog } from './dialog'

describe('Dialog', () => {
  it('opens and closes through accessible controls', async () => {
    const user = userEvent.setup()

    render(
      <Dialog
        trigger={<Button>查看说明</Button>}
        title="模板说明"
        description="这是一个 Radix Dialog。"
        closeLabel="关闭"
      >
        <p>内容</p>
      </Dialog>,
    )

    await user.click(screen.getByRole('button', { name: '查看说明' }))
    expect(screen.getByRole('dialog', { name: '模板说明' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog', { name: '模板说明' })).not.toBeInTheDocument()
  })
})
