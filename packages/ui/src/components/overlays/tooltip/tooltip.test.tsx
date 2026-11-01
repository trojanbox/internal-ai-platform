import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Button } from '../../actions/button/button'
import { Tooltip, TooltipProvider } from './tooltip'

describe('Tooltip', () => {
  it('exposes supplemental content on keyboard focus', async () => {
    const user = userEvent.setup()

    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="当前账户">
          <Button>账户</Button>
        </Tooltip>
      </TooltipProvider>,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: '账户' })).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('当前账户')
  })
})
