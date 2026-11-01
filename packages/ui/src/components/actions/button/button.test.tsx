import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Button } from './button'

describe('Button', () => {
  it('forwards native button behavior', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(<Button onClick={onClick}>保存</Button>)
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    render(
      <Button disabled onClick={onClick}>
        保存
      </Button>,
    )
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(onClick).not.toHaveBeenCalled()
  })
})
