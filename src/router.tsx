import {
  createHashHistory,
  createRouter,
  createRoute,
  createRootRoute,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import App from './App'
import ProductsLoading from './app/products/loading'
import { SETTINGS_TAB_IDS } from './components/email/settings-tab-ids'
import type { SettingsTab } from './components/email/workspace-context'

const HomePage = lazyRouteComponent(() => import('./app/page'))
const CustomersPage = lazyRouteComponent(() => import('./app/customers/page'))
const CustomerDetailPage = lazyRouteComponent(() => import('./app/customers/[id]/page'))
const DealsPage = lazyRouteComponent(() => import('./app/deals/page'))
const DealDetailPage = lazyRouteComponent(() => import('./app/deals/[id]/page'))
const TasksPage = lazyRouteComponent(() => import('./app/tasks/page'))
const CalendarPage = lazyRouteComponent(() => import('./app/calendar/page'))
const LoginPage = lazyRouteComponent(() => import('./app/login/page'))
const ErrorPage = lazyRouteComponent(() => import('./app/error/page'))
const SettingsPage = lazyRouteComponent(() => import('./app/settings/page'))
const SettingsLayout = lazyRouteComponent(() => import('./app/settings/layout'))
const CustomFieldsPage = lazyRouteComponent(() => import('./app/settings/custom-fields/page'))
const MaintenancePage = lazyRouteComponent(() => import('./app/settings/maintenance/page'))
const ProductsPage = lazyRouteComponent(() => import('./app/products/page'))
const FollowUpPage = lazyRouteComponent(() => import('./app/followup/page'))
const ReturnsPage = lazyRouteComponent(() => import('./app/returns/page'))
const PortalReturnsNewPage = lazyRouteComponent(() => import('./app/portal/returns-new/page'))
const PortalReturnsLookupPage = lazyRouteComponent(() => import('./app/portal/returns-lookup/page'))
const PortalReturnsStatusPage = lazyRouteComponent(() => import('./app/portal/returns-status/page'))
const EmailModuleLayout = lazyRouteComponent(() => import('./app/email/layout'))
const EmailPage = lazyRouteComponent(() => import('./app/email/page'))
const EmailWorkflowsPage = lazyRouteComponent(() => import('./app/email/workflows/page'))
const EmailSettingsPage = lazyRouteComponent(() => import('./app/email/settings/page'))
const EmailReportingPage = lazyRouteComponent(() => import('./app/email/reporting/page'))
const EmailSvelteLabPage = lazyRouteComponent(() => import('./app/email/svelte-lab/page'))

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
const returnsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/returns', component: ReturnsPage })

// Public, unauthenticated customer portal. These routes intentionally do NOT
// participate in the app's auth guard — the portal token in the path is the
// sole credential the server uses to resolve a workspace.
const portalReturnsNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/portal/$token/returns/new',
  component: PortalReturnsNewPage,
})
const portalReturnsLookupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/portal/$token/returns/lookup',
  component: PortalReturnsLookupPage,
})
const portalReturnsStatusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/portal/$token/returns/$returnNumber',
  component: PortalReturnsStatusPage,
})

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
      tab: validTab as SettingsTab,
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
  returnsRoute,
  portalReturnsNewRoute,
  portalReturnsLookupRoute,
  portalReturnsStatusRoute,
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
