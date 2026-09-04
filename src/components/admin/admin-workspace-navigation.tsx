"use client";

import {
  Activity,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

export type AdminWorkspaceView = "overview" | "requests" | "members" | "licences" | "system";

interface AdminViewDefinition {
  id: AdminWorkspaceView;
  label: string;
  icon: LucideIcon;
}

const adminViews: readonly AdminViewDefinition[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "requests", label: "Requests", icon: ClipboardCheck },
  { id: "members", label: "Members", icon: UsersRound },
  { id: "licences", label: "Licences", icon: CreditCard },
  { id: "system", label: "System", icon: Activity },
];

interface AdminWorkspaceNavigationContextValue {
  active: boolean;
  view: AdminWorkspaceView;
  selectView: (view: AdminWorkspaceView) => void;
}

const AdminWorkspaceNavigationContext = createContext<AdminWorkspaceNavigationContextValue | null>(null);

export function AdminWorkspaceNavigationProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const [view, setView] = useState<AdminWorkspaceView>("overview");

  useEffect(() => {
    if (!active) return;

    const readLocation = () => setView(viewFromHash(window.location.hash));
    const frame = window.requestAnimationFrame(readLocation);
    window.addEventListener("hashchange", readLocation);
    window.addEventListener("popstate", readLocation);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", readLocation);
      window.removeEventListener("popstate", readLocation);
    };
  }, [active]);

  const selectView = useCallback((nextView: AdminWorkspaceView) => {
    setView(nextView);
    const nextUrl = new URL(window.location.href);
    nextUrl.hash = nextView === "overview" ? "" : nextView;
    window.history.pushState(null, "", nextUrl);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelector<HTMLElement>(".app-scroll")?.scrollTo({
      top: 0,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, []);

  const value = useMemo(() => ({ active, view, selectView }), [active, selectView, view]);
  return <AdminWorkspaceNavigationContext.Provider value={value}>{children}</AdminWorkspaceNavigationContext.Provider>;
}

export function AdminWorkspaceNavigation() {
  const { active, view, selectView } = useAdminWorkspaceNavigation();
  if (!active) return null;

  function handleTabKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % adminViews.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + adminViews.length) % adminViews.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = adminViews.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextView = adminViews[nextIndex]!.id;
    selectView(nextView);
    window.requestAnimationFrame(() => document.getElementById(`admin-tab-${nextView}`)?.focus());
  }

  return (
    <nav className="workspace-view-nav" aria-label="Owner console views">
      <div className="workspace-view-nav__inner" role="tablist" aria-label="Access management sections">
        {adminViews.map(({ id, label, icon: Icon }, index) => {
          const selected = view === id;
          return (
            <button
              id={`admin-tab-${id}`}
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`admin-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? "workspace-view-nav__item workspace-view-nav__item--active" : "workspace-view-nav__item"}
              onClick={() => selectView(id)}
              onKeyDown={(event) => handleTabKey(event, index)}
            >
              <span><Icon size={17} strokeWidth={1.8} /></span>
              <small>{label}</small>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function AdminWorkspacePanels({
  overview,
  requests,
  members,
  licences,
  system,
}: Record<AdminWorkspaceView, ReactNode>) {
  const { view } = useAdminWorkspaceNavigation();
  const panels: Record<AdminWorkspaceView, ReactNode> = { overview, requests, members, licences, system };

  return (
    <div className="admin-view-panels">
      {adminViews.map(({ id, label }) => (
        <section
          className="admin-view-panel"
          id={`admin-panel-${id}`}
          key={id}
          role="tabpanel"
          aria-labelledby={`admin-tab-${id}`}
          aria-label={`${label} view`}
          hidden={view !== id}
        >
          {panels[id]}
        </section>
      ))}
    </div>
  );
}

function useAdminWorkspaceNavigation(): AdminWorkspaceNavigationContextValue {
  const value = useContext(AdminWorkspaceNavigationContext);
  if (!value) throw new Error("Admin workspace navigation must be rendered inside its provider.");
  return value;
}

function viewFromHash(hash: string): AdminWorkspaceView {
  const candidate = hash.replace(/^#/, "");
  return adminViews.some((view) => view.id === candidate) ? candidate as AdminWorkspaceView : "overview";
}
