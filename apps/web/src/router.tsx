import { createBrowserRouter, Navigate } from 'react-router-dom'

import { LoginPage } from './features/authentication/pages/login/login.page'
import { RegisterPage } from './features/authentication/pages/register/register.page'
import { loginAction } from './features/authentication/routes/login.action'
import { logoutAction } from './features/authentication/routes/logout.action'
import { registerAction } from './features/authentication/routes/register.action'
import { sessionLoader } from './features/authentication/routes/session.loader'
import { ItemDetailPage } from './features/items/pages/item-detail/item-detail.page'
import { ItemsPage } from './features/items/pages/items/items.page'
import { itemDetailLoader } from './features/items/routes/item-detail.loader'
import { itemsLoader } from './features/items/routes/items.loader'
import { AppLayout } from './layout/app-layout/app-layout'
import { RouteErrorPage } from './routing/route-error/route-error'

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
    action: loginAction,
  },
  {
    path: '/register',
    element: <RegisterPage />,
    action: registerAction,
  },
  {
    id: 'app',
    path: '/',
    loader: sessionLoader,
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Navigate replace to="/items" /> },
      { path: 'items', loader: itemsLoader, element: <ItemsPage /> },
      { path: 'items/:itemId', loader: itemDetailLoader, element: <ItemDetailPage /> },
      { path: 'logout', action: logoutAction },
    ],
  },
])
