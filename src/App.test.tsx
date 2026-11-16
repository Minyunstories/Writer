import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { AppRoutes } from './App'

test('shows the app name on the dashboard route', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <AppRoutes />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('heading', { name: 'MinyunWriter' })).toBeInTheDocument()
})
