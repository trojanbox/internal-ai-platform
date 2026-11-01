import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Button } from '../../actions/button/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'

describe('DropdownMenu', () => {
  it('opens through the trigger and invokes an item action', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>打开菜单</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>退出登录</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    await user.click(screen.getByRole('button', { name: '打开菜单' }))
    const item = await screen.findByRole('menuitem', { name: '退出登录' })
    expect(item).toBeVisible()

    await user.click(item)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
