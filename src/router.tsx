import {
  createHashHistory,
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
} from '@tanstack/react-router'

import App from './App'
import HomePage from './app/page'
import CustomersPage from './app/customers/page'
import CustomerDetailPage from './app/customers/[id]/page'
import DealsPage from './app/deals/page'
import DealDetailPage from './app/deals/[id]/page'
import TasksPage from './app/tasks/page'
import CalendarPage from './app/calendar/page'
import LoginPage from './app/login/page'
import ErrorPage from './app/error/page'
import SettingsPage from './app/settings/page'
import SettingsLayout from './app/settings/layout'
import CustomFieldsPage from './app/settings/custom-fields/page'
import MaintenancePage from './app/settings/maintenance/page'
import ProductsPage from './app/products/page'
import ProductsLoading from './app/products/loading'
import FollowUpPage from './app/followup/page'
import EmailModuleLayout from './app/email/layout'
import EmailPage from './app/email/page'
import EmailWorkflowsPage from './app/email/workflows/page'
import EmailSettingsPage from './app/email/settings/page'
import EmailReportingPage from './app/email/reporting/page'
import EmailSvelteLabPage from './app/email/svelte-lab/page'
import { SETTINGS_TAB_IDS } from './components/email/settings-panels'

const svelteLabEnabled = import.meta.env.VITE_ENABLE_SVELTE_LAB === 'true'

const rootRoute = createRootRoute({ component: App })

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage })
const customersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/customers', component: CustomersPage })
export const customerDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/customers/$customerId', component: CustomerDetailPage })
const dealsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/deals', component: DealsPage })
const dealDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/deals/$dealId', component: DealDetailPage })
const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tasks', component: TasksPage })
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  validateSearch: (search: Record<string, unknown>) => ({
    date: typeof search.date === 'string' ? search.date : undefined,
  }),
  component: CalendarPage,
})
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage })
const errorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/error', component: ErrorPage })

const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsLayout })
const settingsIndexRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/', component: SettingsPage })
const customFieldsRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/custom-fields', component: CustomFieldsPage })
const maintenanceRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/maintenance', component: MaintenancePage })

const productsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/products', component: ProductsPage, pendingComponent: ProductsLoading })
const followUpRoute = createRoute({ getParentRoute: () => rootRoute, path: '/followup', component: FollowUpPage })

const emailLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/email',
  component: EmailModuleLayout,
})
const emailIndexRoute = createRoute({
  getParentRoute: () => emailLayoutRoute,
  path: '/',
  component: EmailPage,
})
const emailWorkflowsRoute = createRoute({
  getParentRoute: () => emailLayoutRoute,
  path: '/workflows',
  component: EmailWorkflowsPage,
})
const emailSettingsRoute = createRoute({
  getParentRoute: () => emailLayoutRoute,
  path: '/settings',
  validateSearch: (search: Record<string, unknown>) => {
    const legacySection =
      typeof search.section === 'string' ? search.section : undefined
    const tabParam = typeof search.tab === 'string' ? search.tab : legacySection
    const legacyTabMap: Record<string, (typeof SETTINGS_TAB_IDS)[number]> = {
      accounts: 'accounts',
      smtp: 'accounts',
      oauth: 'accounts',
      oauthApps: 'oauthApps',
      ai: 'ai',
      knowledge: 'knowledge',
      'mail-security': 'mailSecurity',
      mailSecurity: 'mailSecurity',
      automation: 'automation',
      team: 'team',
      canned: 'canned',
      prompts: 'prompts',
      export: 'export',
      misc: 'misc',
    }
    const mapped =
      tabParam && legacyTabMap[tabParam] ? legacyTabMap[tabParam] : tabParam
    const validTab =
      mapped && (SETTINGS_TAB_IDS as readonly string[]).includes(mapped)
        ? mapped
        : 'accounts'
    return {
      tab: validTab as (typeof SETTINGS_TAB_IDS)[number],
    }
  },
  component: EmailSettingsPage,
})
const emailReportingRoute = createRoute({
  getParentRoute: () => emailLayoutRoute,
  path: '/reporting',
  component: EmailReportingPage,
})
const emailSvelteLabRoute = createRoute({
  getParentRoute: () => emailLayoutRoute,
  path: '/svelte-lab',
  component: EmailSvelteLabPage,
})

const catchAllRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '*',
  beforeLoad: () => { throw redirect({ to: '/' }) },
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  customersRoute,
  customerDetailRoute,
  dealsRoute,
  dealDetailRoute,
  tasksRoute,
  calendarRoute,
  loginRoute,
  errorRoute,
  settingsRoute.addChildren([settingsIndexRoute, customFieldsRoute, maintenanceRoute]),
  productsRoute,
  followUpRoute,
  emailLayoutRoute.addChildren([
    emailIndexRoute,
    emailWorkflowsRoute,
    emailSettingsRoute,
    emailReportingRoute,
    ...(svelteLabEnabled ? [emailSvelteLabRoute] : []),
  ]),
  catchAllRoute,
])

/** Electron/file:// and dev need hash routing so in-app links never become file:///path */
function createAppHistory() {
  if (typeof window === 'undefined') return undefined
  const inElectron = Boolean(
    (window as unknown as { electronAPI?: { invoke?: unknown } }).electronAPI?.invoke,
  )
  const needsHash =
    inElectron ||
    window.location.protocol === 'file:' ||
    window.location.protocol === 'app:'
  return needsHash ? createHashHistory() : undefined
}

export const router = createRouter({
  routeTree,
  history: createAppHistory(),
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
