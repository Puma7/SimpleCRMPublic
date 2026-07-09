// @ts-nocheck
import { Link } from "@tanstack/react-router"
import {
  Users,
  FileBox,
  CheckSquare,
  CheckCircle,
  Settings,
  CalendarDays,
  Package,
  ListChecks,
  LayoutDashboard,
  Mail,
  Search,
  PackageOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { UserSwitcher } from "@/components/auth/user-switcher"
import { LanguageToggle } from "@/components/language-toggle"
import { useTranslation } from "@/lib/i18n"

const navLinks = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, exact: true },
  { to: "/followup", labelKey: "nav.followup", icon: ListChecks },
  { to: "/customers", labelKey: "nav.customers", icon: Users },
  { to: "/deals", labelKey: "nav.deals", icon: FileBox },
  { to: "/tasks", labelKey: "nav.tasks", icon: CheckSquare },
  { to: "/products", labelKey: "nav.products", icon: Package },
  { to: "/calendar", labelKey: "nav.calendar", icon: CalendarDays },
  { to: "/email", labelKey: "nav.email", icon: Mail },
  { to: "/returns", labelKey: "nav.returns", icon: PackageOpen },
] as const

export function MainNav({
  className,
  onOpenCommandPalette,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  onOpenCommandPalette?: () => void
}) {
  const { t } = useTranslation()
  return (
    <nav className={cn("border-b", className)} {...props}>
      <div className="flex h-16 items-center px-4">
        <Link to="/" className="mr-6 flex items-center space-x-2">
          <CheckCircle className="h-6 w-6" />
          <span className="font-bold">SimpleCRM</span>
        </Link>
        <div className="flex flex-1 items-center space-x-4 lg:space-x-6">
          {navLinks.map(({ to, labelKey, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center space-x-2 text-sm font-medium transition-colors hover:text-primary",
              )}
              activeProps={{
                className:
                  "text-primary font-semibold border-b-2 border-primary pb-[1.19rem] -mb-[1.19rem]",
              }}
              inactiveProps={{ className: "text-muted-foreground" }}
            >
              <Icon className="h-4 w-4" />
              <span>{t(labelKey)}</span>
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <LanguageToggle className="hidden h-8 w-[7.5rem] sm:flex" />
          {onOpenCommandPalette ? (
            <button
              type="button"
              className="hidden items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground sm:flex"
              title="Befehlspalette (Strg+K)"
              onClick={onOpenCommandPalette}
            >
              <Search className="h-3.5 w-3.5" />
              <span>Strg+K</span>
            </button>
          ) : null}
          <UserSwitcher />
          <Link
            to="/settings"
            className={cn(
              "flex items-center space-x-2 text-sm font-medium transition-colors hover:text-primary",
            )}
            activeProps={{ className: "text-primary" }}
            inactiveProps={{ className: "text-muted-foreground" }}
          >
            <Settings className="h-4 w-4" />
            <span>{t("nav.settings")}</span>
          </Link>
        </div>
      </div>
    </nav>
  )
}
