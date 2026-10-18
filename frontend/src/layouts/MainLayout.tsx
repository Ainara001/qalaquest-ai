import { useTranslation } from "react-i18next";
import { Footprints } from "lucide-react";
import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useViewportVars } from "@/hooks/useViewportVars";
import { cn } from "@/lib/utils";
import { navItems } from "@/sections";
import { remainingMinutes, useWalk } from "@/stores/walk";

const desktopLink = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );

// Pages that fill the whole area between header and bottom bar (no page scroll).
const FULL_BLEED = ["/", "/guide"];

export function MainLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  useViewportVars();
  const full = FULL_BLEED.includes(pathname);
  const isMap = pathname === "/";
  const walk = useWalk((w) => w.session);
  // the map shows the active walk itself; other pages get a compact bar that leads back to it
  const showPill = !!walk && !isMap;
  // the active-walk bar takes room from full-height pages instead of covering them
  useEffect(() => {
    document.documentElement.style.setProperty("--pill-h", showPill ? "2.75rem" : "0px");
  }, [showPill]);
  // on phones the map screen has no header: the search field sits at the top of the map
  useEffect(() => {
    document.documentElement.classList.toggle("map-screen", isMap);
    return () => document.documentElement.classList.remove("map-screen");
  }, [isMap]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className={cn("sticky top-0 z-30 border-b bg-background/90 backdrop-blur", isMap && "max-md:hidden")} style={{ height: "var(--header-h)", paddingTop: "var(--safe-t)", boxSizing: "content-box" }}>
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-3 px-4">
          <NavLink to="/" aria-label={t("common.homeAria")}>
            <Logo />
          </NavLink>
          <nav className="hidden items-center gap-1 md:flex" aria-label={t("common.mainNav")}>
            {navItems.map(({ key, path, icon: Icon }) => (
              <NavLink key={path} to={path} end={path === "/"} className={desktopLink}>
                <Icon className="h-4 w-4" />
                {t(`nav.${key}`)}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            <span className="hidden md:inline">
              <ThemeToggle />
            </span>
          </div>
        </div>
      </header>

      {showPill && walk && (
        <Link
          to="/?panel=walk"
          className="sticky z-20 flex h-11 items-center justify-center gap-2 border-b bg-accent px-4 text-sm font-medium text-accent-foreground"
          style={{ top: "var(--header-eff)" }}
        >
          <Footprints className="h-4 w-4" />
          {t("walk.statusPill", { count: walk.route.stops.length, min: remainingMinutes(walk) })}
          <span className="font-semibold underline underline-offset-2">{t("walk.open")}</span>
        </Link>
      )}

      <main
        className={cn(
          "mx-auto w-full max-w-6xl flex-1",
          full ? (isMap ? "md:max-w-none" : "md:px-4 md:py-4") : "px-4 py-4 md:py-8",
          // reserve room for the fixed bottom bar (and the home indicator) on phones
          "pb-[var(--nav-eff)] md:pb-0",
          !full && "pb-nav md:pb-8",
        )}
      >
        <Outlet />
      </main>

      {!full && <footer className="hidden border-t py-6 text-center text-sm text-muted-foreground md:block">{t("footer.text")}</footer>}

      {/* Phone bottom navigation: the only navigation bar on small screens */}
      <nav
        aria-label={t("common.mobileNav")}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden [.kb-open_&]:hidden"
        style={{ paddingBottom: "var(--safe-b)" }}
      >
        <ul className="mx-auto grid max-w-lg grid-cols-3" style={{ height: "var(--nav-h)" }}>
          {navItems.map(({ key, path, icon: Icon }) => (
            <li key={path}>
              <NavLink
                to={path}
                end={path === "/"}
                className={({ isActive }) =>
                  cn(
                    "relative flex h-full flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium leading-tight transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground active:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-[hsl(var(--brand))]" />}
                    <Icon className="h-6 w-6" strokeWidth={isActive ? 2.4 : 1.9} />
                    <span className="max-w-full truncate">{t(`nav.${key}`)}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
