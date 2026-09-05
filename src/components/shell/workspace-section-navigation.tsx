"use client";

import {
  Activity,
  AlarmClock,
  BarChart3,
  CalendarRange,
  CircleDollarSign,
  ClipboardList,
  Crosshair,
  Gauge,
  History,
  KeyRound,
  LayoutDashboard,
  LayoutList,
  RotateCcw,
  ScrollText,
  Settings2,
  ShieldCheck,
  Swords,
  Trophy,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { publishViewSwitch } from "@/components/shell/route-progress";

interface WorkspaceSectionItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: Route;
  includeDescendants?: boolean;
}

interface WorkspaceSectionDefinition {
  key: string;
  label: string;
  tabPrefix: string;
  mode: "local" | "routes";
  defaultView: string;
  items: readonly WorkspaceSectionItem[];
}

const chainOperations: WorkspaceSectionDefinition = {
  key: "chains",
  label: "Chain operation views",
  tabPrefix: "chain-operations",
  mode: "routes",
  defaultView: "overview",
  items: [
    { id: "overview", label: "Overview", icon: LayoutDashboard, href: "/dashboard" },
    { id: "live", label: "Live", icon: Activity, href: "/live-chain" },
    { id: "watch", label: "Watch", icon: AlarmClock, href: "/chain-watch" },
    { id: "history", label: "History", icon: History, href: "/chains", includeDescendants: true },
    { id: "analytics", label: "Analytics", icon: BarChart3, href: "/analytics" },
  ],
};

const memberOperations: WorkspaceSectionDefinition = {
  key: "members",
  label: "Members workspace views",
  tabPrefix: "members",
  mode: "local",
  defaultView: "overview",
  items: [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "roster", label: "Roster", icon: UsersRound },
    { id: "patterns", label: "Patterns", icon: CalendarRange },
    { id: "controls", label: "Controls", icon: Settings2 },
  ],
};

const accessOperations: WorkspaceSectionDefinition = {
  key: "access",
  label: "Faction access views",
  tabPrefix: "access",
  mode: "local",
  defaultView: "overview",
  items: [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "directory", label: "Directory", icon: LayoutList },
    { id: "assignments", label: "Access", icon: KeyRound },
    { id: "roles", label: "Roles", icon: ShieldCheck },
    { id: "audit", label: "Audit", icon: ScrollText },
  ],
};

const organizedCrimes: WorkspaceSectionDefinition = {
  key: "organized-crimes",
  label: "Organized crimes views",
  tabPrefix: "organized-crimes",
  mode: "local",
  defaultView: "overview",
  items: [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "review", label: "Battle stats", icon: Gauge },
    { id: "suggestions", label: "Suggestions", icon: Crosshair },
    { id: "contributions", label: "Contributions", icon: ShieldCheck },
    { id: "my-stats", label: "My stats", icon: Swords },
  ],
};

const rewardOperations: WorkspaceSectionDefinition = {
  key: "rewards",
  label: "Reward operation views",
  tabPrefix: "reward-operations",
  mode: "routes",
  defaultView: "schemes",
  items: [
    { id: "schemes", label: "Schemes", icon: CircleDollarSign, href: "/rewards" },
    { id: "payouts", label: "Payouts", icon: LayoutDashboard, href: "/payouts" },
    { id: "ledger", label: "Ledger", icon: ClipboardList, href: "/payouts/ledger" },
    { id: "recipients", label: "Recipients", icon: Trophy, href: "/payouts/recipients" },
    { id: "corrections", label: "Corrections", icon: RotateCcw, href: "/payouts/corrections" },
  ],
};

interface WorkspaceSectionContextValue {
  definition: WorkspaceSectionDefinition | null;
  view: string | null;
  selectView: (view: string) => void;
}

const WorkspaceSectionContext = createContext<WorkspaceSectionContextValue | null>(null);

export function WorkspaceSectionNavigationProvider({ pathname, children }: { pathname: string; children: ReactNode }) {
  const definition = definitionForPath(pathname);
  const [view, setView] = useState<string | null>(definition?.defaultView ?? null);

  useEffect(() => {
    if (!definition || definition.mode !== "local") return;

    const readLocation = () => setView(sectionFromLocation(definition));
    const frame = window.requestAnimationFrame(readLocation);
    window.addEventListener("popstate", readLocation);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("popstate", readLocation);
    };
  }, [definition]);

  const selectView = useCallback((nextView: string) => {
    if (!definition || definition.mode !== "local" || !definition.items.some((item) => item.id === nextView)) return;
    setView(nextView);
    publishViewSwitch(`${definition.key}:${nextView}`);

    const nextUrl = new URL(window.location.href);
    if (nextView === definition.defaultView) nextUrl.searchParams.delete("section");
    else nextUrl.searchParams.set("section", nextView);
    window.history.pushState(null, "", nextUrl);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelector<HTMLElement>(".app-scroll")?.scrollTo({
      top: 0,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [definition]);

  const resolvedView = definition
    ? definition.items.some((item) => item.id === view) ? view : definition.defaultView
    : null;
  const value = useMemo(() => ({ definition, view: resolvedView, selectView }), [definition, resolvedView, selectView]);
  return <WorkspaceSectionContext.Provider value={value}>{children}</WorkspaceSectionContext.Provider>;
}

export function WorkspaceSectionNavigation({ pathname }: { pathname: string }) {
  const context = useWorkspaceSectionContext();
  const definition = definitionForPath(pathname);
  if (!definition) return null;

  const { items, tabPrefix } = definition;
  const localView = context.definition?.key === definition.key ? context.view : definition.defaultView;
  const itemStyle = { "--workspace-nav-items": items.length } as CSSProperties;

  function handleTabKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % items.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = items[nextIndex];
    if (!next) return;
    context.selectView(next.id);
    window.requestAnimationFrame(() => document.getElementById(`${tabPrefix}-tab-${next.id}`)?.focus());
  }

  return (
    <nav className="workspace-view-nav" aria-label={definition.label}>
      <div className="workspace-view-nav__inner" role={definition.mode === "local" ? "tablist" : undefined} style={itemStyle}>
        {items.map(({ id, label, icon: Icon, href, includeDescendants }, index) => {
          const selected = definition.mode === "local"
            ? localView === id
            : Boolean(href && (pathname === href || (includeDescendants && pathname.startsWith(`${href}/`))));
          const className = selected ? "workspace-view-nav__item workspace-view-nav__item--active" : "workspace-view-nav__item";
          const contents = <><span><Icon size={17} strokeWidth={1.8} /></span><small>{label}</small></>;

          if (definition.mode === "routes" && href) {
            return <Link key={id} href={href} aria-current={selected ? "page" : undefined} className={className}>{contents}</Link>;
          }

          return (
            <button
              id={`${tabPrefix}-tab-${id}`}
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${tabPrefix}-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              className={className}
              onClick={() => context.selectView(id)}
              onKeyDown={(event) => handleTabKey(event, index)}
            >
              {contents}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function useWorkspaceSectionNavigation(key: string): { view: string; selectView: (view: string) => void } {
  const context = useWorkspaceSectionContext();
  if (context.definition?.key !== key || context.view === null) {
    throw new Error(`The ${key} workspace must be rendered inside its matching section navigation provider.`);
  }
  return { view: context.view, selectView: context.selectView };
}

export function hasWorkspaceSectionNavigation(pathname: string): boolean {
  return definitionForPath(pathname) !== null;
}

function useWorkspaceSectionContext(): WorkspaceSectionContextValue {
  const value = useContext(WorkspaceSectionContext);
  if (!value) throw new Error("Workspace section navigation must be rendered inside its provider.");
  return value;
}

function definitionForPath(pathname: string): WorkspaceSectionDefinition | null {
  if (pathname === "/members") return memberOperations;
  if (pathname === "/organized-crimes") return organizedCrimes;
  if (pathname === "/faction") return accessOperations;
  if (pathname === "/rewards" || pathname === "/payouts" || pathname.startsWith("/payouts/")) return rewardOperations;
  if (pathname === "/dashboard" || pathname === "/live-chain" || pathname === "/chain-watch" || pathname === "/chains" || pathname.startsWith("/chains/") || pathname === "/analytics") return chainOperations;
  return null;
}

function sectionFromLocation(definition: WorkspaceSectionDefinition): string {
  const candidate = new URLSearchParams(window.location.search).get("section");
  return definition.items.some((item) => item.id === candidate) ? candidate! : definition.defaultView;
}
