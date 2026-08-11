"use client";

import {
  Activity,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Command,
  Gauge,
  History,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MonitorCog,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { BrandMark } from "@/components/brand-mark";
import { UpgradeAccess } from "@/components/licensing/upgrade-access";
import { NavigationBeacon, publishNavigationState, RouteProgress } from "@/components/shell/route-progress";
import { ServiceStateDrawer } from "@/components/shell/service-state-drawer";
import { StatusDot } from "@/components/ui/status-dot";
import { applyAppearancePreferences, saveAppearancePreferences, useAppearancePreferences } from "@/lib/appearance-preferences";
import { PLATFORM_OWNER, type PlatformActor } from "@/lib/auth/platform-owner";
import { notify, type ToastDetail, type ToastTone } from "@/lib/client-actions";
import type { DatabaseStatus } from "@/lib/data/database-status";
import type { FactionAccessSummary } from "@/lib/licensing/types";
import type { MemberActivityAlertSummary } from "@/lib/members/member-activity-intelligence";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

interface NavigationItem {
  label: string;
  href: Route;
  icon: LucideIcon;
  badge?: string;
  shortcut?: string;
  requiresLicense?: boolean;
  locked?: boolean;
}

interface NavigationGroup {
  label?: string;
  items: NavigationItem[];
}

const navigation: NavigationGroup[] = [
  { items: [{ label: "Overview", href: "/dashboard", icon: LayoutDashboard, shortcut: "G D", requiresLicense: true }] },
  {
    label: "Chain operations",
    items: [
      { label: "Live chain", href: "/live-chain", icon: Activity, shortcut: "G L", requiresLicense: true },
      { label: "Members", href: "/members", icon: Users, shortcut: "G M", requiresLicense: true },
      { label: "Chain history", href: "/chains", icon: History, shortcut: "G H", requiresLicense: true },
      { label: "Analytics", href: "/analytics", icon: BarChart3, shortcut: "G A", requiresLicense: true },
    ],
  },
  {
    label: "Reward operations",
    items: [
      { label: "Reward schemes", href: "/rewards", icon: CircleDollarSign, shortcut: "G R", requiresLicense: true },
      { label: "Payout ledger", href: "/payouts", icon: WalletCards, shortcut: "G P", requiresLicense: true },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Faction access", href: "/faction", icon: ShieldCheck, shortcut: "G F", requiresLicense: true },
      { label: "Settings", href: "/settings", icon: SlidersHorizontal, shortcut: "G S" },
    ],
  },
  {
    label: "Platform",
    items: [{ label: "Administration", href: "/admin", icon: Settings }],
  },
];

type OpenPanel = "faction" | "notifications" | "user" | "health" | null;

interface ToastState extends ToastDetail {
  id: number;
}

interface SystemNotification {
  id: number;
  title: string;
  detail: string;
  tone: "warning" | "danger";
  unread: boolean;
  href?: Route;
}

export function AppShell({ children, currentUser, telemetry, access, database, memberActivityAlert }: { children: ReactNode; currentUser: PlatformActor; telemetry: WorkspaceTelemetry; access: FactionAccessSummary; database: DatabaseStatus; memberActivityAlert: MemberActivityAlertSummary | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const preferences = useAppearancePreferences();
  const collapsed = preferences.sidebarCollapsed;
  const compact = preferences.compact;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [telemetryOverride, setTelemetryOverride] = useState<WorkspaceTelemetry | null>(null);
  const [syncState, setSyncState] = useState<"syncing" | "failed" | null>(null);
  const [readNotificationIds, setReadNotificationIds] = useState<number[]>([]);
  const liveTelemetry = newestTelemetry(telemetry, telemetryOverride);
  const syncLabel = syncState === "syncing"
    ? "Syncing..."
    : syncState === "failed"
      ? "Check failed"
      : checkedTimeLabel(liveTelemetry.checkedAt);
  const systemNotifications: SystemNotification[] = [];
  if (liveTelemetry.source === "unavailable") systemNotifications.push({ id: 1, title: "Torn API connection required", detail: liveTelemetry.message, tone: "warning", unread: true });
  // Torn reports seconds remaining at the moment it answered; the shell shows
  // that figure rather than running its own countdown.
  const chainTimeoutRemaining = liveTelemetry.chain?.timeoutSeconds ?? 0;
  if (liveTelemetry.chain?.state === "active" && chainTimeoutRemaining < preferences.chainWarningSeconds) systemNotifications.push({ id: 2, title: "Live chain timeout warning", detail: `${chainTimeoutRemaining} seconds remained at the last Torn check.`, tone: "warning", unread: true, href: "/live-chain" });
  if (memberActivityAlert?.attentionCount) {
    const names = memberActivityAlert.memberNames.join(", ");
    systemNotifications.push({
      id: 3,
      title: memberActivityAlert.criticalCount ? `${memberActivityAlert.criticalCount} critical inactivity alert${memberActivityAlert.criticalCount === 1 ? "" : "s"}` : `${memberActivityAlert.attentionCount} member${memberActivityAlert.attentionCount === 1 ? "" : "s"} need activity review`,
      detail: `${names}${memberActivityAlert.attentionCount > memberActivityAlert.memberNames.length ? ` and ${memberActivityAlert.attentionCount - memberActivityAlert.memberNames.length} more` : ""}. Owner threshold: ${memberActivityAlert.thresholdDays} days.`,
      tone: memberActivityAlert.criticalCount ? "danger" : "warning",
      unread: true,
      href: "/members",
    });
  }
  const notifications = systemNotifications.map((item) => ({ ...item, unread: !readNotificationIds.includes(item.id) }));
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const faction = liveTelemetry.faction;
  const chain = liveTelemetry.chain;
  const offlineMode = liveTelemetry.mode === "offline";
  const workspaceLocked = access.state !== "active";
  const ownerAccess = currentUser.isPlatformAdmin && currentUser.tornUserId === PLATFORM_OWNER.tornUserId;
  const visibleNavigation = navigation
    .filter((group) => group.label !== "Platform" || ownerAccess)
    .map((group) => ({ ...group, items: group.items.map((item) => {
      if (workspaceLocked && item.requiresLicense) return { ...item, locked: true, badge: "Locked" };
      if (item.href === "/live-chain") return { ...item, badge: chain ? chain.current.toLocaleString() : "—" };
      if (item.href === "/members" && memberActivityAlert?.attentionCount) return { ...item, badge: memberActivityAlert.attentionCount.toLocaleString() };
      return item;
    }) }));
  const searchableItems = visibleNavigation.flatMap((group) => group.items);
  // Keyboard shortcuts must not resubscribe on every render, so the latest
  // destinations are read through a ref instead of an effect dependency.
  const searchableItemsRef = useRef(searchableItems);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [navigating, startNavigation] = useTransition();
  const initials = currentUser.name.slice(0, 2).toUpperCase();
  const syncing = syncLabel.startsWith("Syncing");
  const chainActive = chain?.state === "active";
  const chainStatusLabel = chainActive
    ? `${chain.current.toLocaleString()} / ${chain.maximum.toLocaleString()}`
    : chain?.state === "cooldown"
      ? "Cooldown"
      : chain
        ? "No active chain"
        : "Unavailable";
  const chainStatusDetail = chainActive
    ? `Chain #${chain.id}`
    : chain?.id
      ? `Last chain #${chain.id}`
      : "Live chain";

  const unreadCount = notifications.filter((item) => item.unread).length;
  const normalizedCommandQuery = commandQuery.trim().toLowerCase();
  const filteredCommands = normalizedCommandQuery
    ? searchableItems.filter((item) => item.label.toLowerCase().includes(normalizedCommandQuery))
    : searchableItems;

  useEffect(() => {
    applyAppearancePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    searchableItemsRef.current = searchableItems;
  }, [searchableItems]);

  // Next restores scroll on the document, which no longer scrolls. Without this
  // a new route would open at the previous view's scroll offset.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  const publishTelemetry = useCallback((next: WorkspaceTelemetry) => {
    setTelemetryOverride(next);
    setSyncState(null);
    window.dispatchEvent(new CustomEvent<WorkspaceTelemetry>("chainward:telemetry", { detail: next }));
  }, []);

  useEffect(() => {
    function receiveTelemetry(event: Event): void {
      const next = (event as CustomEvent<WorkspaceTelemetry>).detail;
      if (!isWorkspaceTelemetry(next)) return;
      setTelemetryOverride(next);
      setSyncState(null);
    }
    window.addEventListener("chainward:telemetry", receiveTelemetry);
    return () => window.removeEventListener("chainward:telemetry", receiveTelemetry);
  }, []);

  // Torn resets a chain's timeout on every hit, so a 30-120s cadence can show a
  // countdown far lower than reality while a chain is running. The saved
  // preference still governs the idle workspace.
  const chainRunning = liveTelemetry.chain?.state === "active";
  const pollSeconds = chainRunning ? Math.min(preferences.refreshIntervalSeconds, 10) : preferences.refreshIntervalSeconds;

  useEffect(() => {
    if (!preferences.autoRefresh) return;
    let stopped = false;
    let lastPollAt = Date.now();

    async function pollTelemetry(): Promise<void> {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      lastPollAt = Date.now();
      try {
        const response = await fetch("/api/telemetry/live-chain", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const payload: unknown = await response.json();
        if (!response.ok || !isWorkspaceTelemetry(payload) || stopped) return;
        publishTelemetry(payload);
      } catch {
        // A background poll keeps the last verified snapshot; manual sync reports failures.
      }
    }

    // Returning to a tab that was hidden longer than one interval otherwise
    // shows a stale chain count until the next tick fires.
    function refreshOnFocus(): void {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastPollAt < pollSeconds * 1_000) return;
      void pollTelemetry();
    }

    const interval = window.setInterval(() => void pollTelemetry(), pollSeconds * 1_000);
    document.addEventListener("visibilitychange", refreshOnFocus);
    window.addEventListener("online", refreshOnFocus);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      window.removeEventListener("online", refreshOnFocus);
    };
  }, [preferences.autoRefresh, pollSeconds, publishTelemetry]);

  useEffect(() => {
    let navigationPrefix = false;
    let prefixTimer: number | undefined;
    function openCommand(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setOpenPanel(null);
        navigationPrefix = false;
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return;
      const key = event.key.toLowerCase();
      if (navigationPrefix) {
        const destination = searchableItemsRef.current.find((item) => item.shortcut?.toLowerCase() === `g ${key}`);
        navigationPrefix = false;
        if (prefixTimer) window.clearTimeout(prefixTimer);
        if (destination) {
          event.preventDefault();
          router.push(destination.locked ? "/unlock" : destination.href);
        }
        return;
      }
      if (key === "g" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        navigationPrefix = true;
        prefixTimer = window.setTimeout(() => { navigationPrefix = false; }, 1_000);
      }
    }
    window.addEventListener("keydown", openCommand);
    return () => {
      if (prefixTimer) window.clearTimeout(prefixTimer);
      window.removeEventListener("keydown", openCommand);
    };
  }, [router]);

  useEffect(() => {
    function receiveToast(event: Event): void {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { ...detail, id }]);
      window.setTimeout(
        () => setToasts((current) => current.filter((toast) => toast.id !== id)),
        4_500,
      );
    }
    window.addEventListener("chainward:toast", receiveToast);
    return () => window.removeEventListener("chainward:toast", receiveToast);
  }, []);

  function goTo(item: NavigationItem): void {
    setCommandOpen(false);
    setCommandQuery("");
    startNavigation(() => router.push(item.locked ? "/unlock" : item.href));
  }

  function handleCommandKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCommandIndex((current) => filteredCommands.length === 0 ? 0 : (current + 1) % filteredCommands.length);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCommandIndex((current) => filteredCommands.length === 0 ? 0 : (current - 1 + filteredCommands.length) % filteredCommands.length);
    }
    if (event.key === "Enter" && filteredCommands[commandIndex]) {
      event.preventDefault();
      goTo(filteredCommands[commandIndex]);
    }
  }

  async function syncWorkspace(): Promise<void> {
    if (syncing) return;
    setSyncState("syncing");
    try {
      const response = await fetch("/api/telemetry/live-chain?fresh=1", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isWorkspaceTelemetry(payload)) throw new Error("Telemetry sync failed");
      publishTelemetry(payload);
      router.refresh();
      notify({
        title: payload.source === "live" ? "Live Torn data refreshed" : "Torn data unavailable",
        description: payload.source === "live" ? "Torn returned an uncached faction and chain snapshot." : payload.message,
        tone: payload.source === "live" ? "success" : "warning",
      });
    } catch {
      setSyncState("failed");
      notify({ title: "Workspace sync failed", description: "Existing values were retained safely.", tone: "danger" });
    }
  }

  async function disconnectWorkspace(): Promise<void> {
    setOpenPanel(null);
    try {
      const response = await fetch("/api/onboarding/disconnect", { method: "POST" });
      if (!response.ok) throw new Error("The connection could not be cleared.");
      router.push("/connect");
      router.refresh();
    } catch (error) {
      notify({
        title: "Disconnect failed",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        tone: "danger",
      });
    }
  }

  function toggleDensity(): void {
    const next = !compact;
    saveAppearancePreferences({ compact: next });
    notify({
      title: next ? "Compact density enabled" : "Comfortable density enabled",
      description: "Your saved workspace layout has been updated.",
      tone: "info",
    });
  }

  function toggleSidebar(): void {
    saveAppearancePreferences({ sidebarCollapsed: !collapsed });
  }

  useEffect(() => {
    publishNavigationState("command-palette", navigating);
  }, [navigating]);

  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileOpen ? " sidebar--mobile-open" : ""}`}>
        <div className="sidebar__brand-row">
          <Link href={workspaceLocked ? "/unlock" : "/dashboard"} className="sidebar__brand-link" aria-label={workspaceLocked ? "Chainward workspace locked — view unlock status" : "Chainward overview"}><BrandMark /></Link>
          <button className="icon-button sidebar__mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>

        <button className="sidebar-rail-toggle" onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>

        <button className="sidebar-command" onClick={() => setCommandOpen(true)}>
          <Search size={15} /><span>Search workspace</span><kbd>⌘ K</kbd>
        </button>

        <nav className="sidebar__nav" aria-label="Primary navigation">
          {visibleNavigation.map((group, groupIndex) => (
            <div className="nav-group" key={group.label ?? groupIndex}>
              {group.label && <p className="nav-group__label">{group.label}</p>}
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
                const Icon = item.icon;
                return (
                  <Link href={item.locked ? "/unlock" : item.href} key={item.href} data-label={item.label} aria-current={active ? "page" : undefined} className={`nav-item${active ? " nav-item--active" : ""}${item.locked ? " nav-item--locked" : ""}`} /* The collapsed rail shows the label through the styled hover card in
                     shell.css, so a native tooltip here would double up. */
                    title={item.locked ? `${item.label} — unlock Chainward to open` : undefined} aria-label={item.locked ? `${item.label}, locked until Chainward is unlocked` : undefined} onClick={() => setMobileOpen(false)}>
                    <Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.locked && <LockKeyhole className="nav-item__lock" size={12} />}{item.badge && <em>{item.badge}</em>}<NavigationBeacon id={item.href} />
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <button className="sidebar__health" onClick={() => setOpenPanel("health")}>
            <span className="sidebar__health-icon"><Activity size={16} /></span>
            <span className="sidebar__health-copy"><strong>{offlineMode ? "Offline fixture active" : liveTelemetry.source === "live" ? "Torn API verified" : "Connection required"}</strong><small>{offlineMode ? "No Torn network requests" : liveTelemetry.source === "live" ? "Server-side API check" : "No live telemetry"}</small></span>
            <StatusDot tone={liveTelemetry.source === "live" ? "success" : "warning"} pulse={liveTelemetry.source === "live"} />
          </button>
        </div>
      </aside>

      {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <div className="app-main">
        <header className="topbar">
          <div className="topbar__left">
            <button className="icon-button topbar__menu" onClick={() => { saveAppearancePreferences({ sidebarCollapsed: false }); setMobileOpen(true); }} aria-label="Open navigation"><Menu size={20} /></button>
            <div className="topbar-faction-wrap">
              <button className="faction-selector" aria-label="Change faction" aria-expanded={openPanel === "faction"} onClick={() => setOpenPanel(openPanel === "faction" ? null : "faction")}>
                <span className="faction-monogram">{faction?.tag?.slice(0, 2).toUpperCase() || "—"}</span><span className="faction-selector__copy"><strong>{faction?.name ?? "Faction unavailable"}</strong><small>{offlineMode ? `Offline fixture · ID ${faction?.id ?? "—"}` : liveTelemetry.source === "live" ? `${faction?.tag ?? "Faction"} · Torn ID ${faction?.id ?? "—"}` : "Connection required"}</small></span><ChevronDown size={15} />
              </button>
              {openPanel === "faction" && (
                <TopbarPopover className="topbar-popover--faction" close={() => setOpenPanel(null)}>
                  <div className="popover-heading"><span>Faction workspace</span><small>{faction ? "1 connected faction" : "Connection required"}</small></div>
                  {faction && <button className="workspace-option workspace-option--active" onClick={() => { setOpenPanel(null); notify({ title: `${faction.name} selected`, description: "You are already viewing this workspace.", tone: "info" }); }}><span className="faction-monogram">{faction.tag.slice(0, 2).toUpperCase()}</span><span><strong>{faction.name}</strong><small>Verified Torn data · ID {faction.id}</small></span><Check size={14} /></button>}
                  <Link href="/connect" onClick={() => setOpenPanel(null)} className="popover-action"><KeyRound size={14} /> Connect another faction</Link>
                </TopbarPopover>
              )}
            </div>
            <div className="topbar__separator" />
            <Link href={workspaceLocked ? "/unlock" : "/live-chain"} aria-label={workspaceLocked ? "Live chain is locked until Chainward is unlocked" : undefined} className={`chain-state chain-state--${chain?.state ?? "unavailable"}`}>
              <StatusDot tone={chainActive ? "success" : chain ? "muted" : "warning"} pulse={chainActive} />
              <span className="chain-state__copy"><small>{chainStatusDetail}</small><strong>{chainStatusLabel}</strong></span>
              {chainActive && chain.maximum > 0 && <i>{((chain.current / chain.maximum) * 100).toFixed(1)}%</i>}
            </Link>
          </div>

          <div className="topbar__right">
            <UpgradeAccess access={access} />
            <button className="topbar-command" onClick={() => setCommandOpen(true)}><Command size={14} /><span>Quick find</span><kbd>⌘K</kbd></button>
            <button className={`data-status-control data-status-control--${offlineMode ? "offline" : liveTelemetry.source}`} onClick={() => void syncWorkspace()} disabled={syncing || workspaceLocked} title={workspaceLocked ? "Live sync unlocks with the operational workspace" : `Last server check: ${new Date(liveTelemetry.checkedAt).toLocaleString("en-GB")}`}>
              <StatusDot tone={liveTelemetry.source === "live" ? "success" : "warning"} pulse={liveTelemetry.source === "live" && !syncing} />
              <span><strong>{offlineMode ? "Offline fixture" : liveTelemetry.source === "live" ? "Torn API" : "API attention"}</strong><small>{syncLabel}</small></span>
              <RefreshCw className={syncing ? "spin" : undefined} size={14} aria-hidden="true" />
            </button>
            <div className="topbar-popover-wrap">
              <button className="icon-button notification-button" onClick={() => setOpenPanel(openPanel === "notifications" ? null : "notifications")} aria-label="Notifications" aria-expanded={openPanel === "notifications"}>
                <Bell size={18} />{unreadCount > 0 && <span className="notification-button__badge">{unreadCount}</span>}
              </button>
              {openPanel === "notifications" && (
                <TopbarPopover className="topbar-popover--notifications" close={() => setOpenPanel(null)}>
                  <div className="popover-heading popover-heading--action"><span>Notifications</span><button onClick={() => setReadNotificationIds(notifications.map((item) => item.id))}>Mark all read</button></div>
                  <div className="notification-list">
                    {notifications.map((item) => <button key={item.id} onClick={() => { setReadNotificationIds((current) => current.includes(item.id) ? current : [...current, item.id]); if (item.href) { setOpenPanel(null); router.push(item.href); } }}><i className={`notification-tone notification-tone--${item.tone}`} /><span><strong>{item.title}</strong><small>{item.detail}</small></span>{item.unread && <em />}</button>)}
                    {notifications.length === 0 && <div className="table-empty">No operational notifications.</div>}
                  </div>
                  {ownerAccess && <Link href="/admin" onClick={() => setOpenPanel(null)} className="popover-action">Open owner operations <span>→</span></Link>}
                </TopbarPopover>
              )}
            </div>
            <div className="topbar-popover-wrap">
              <button className="user-menu" onClick={() => setOpenPanel(openPanel === "user" ? null : "user")} aria-label="Open user menu" aria-expanded={openPanel === "user"}>
                <span className="user-menu__avatar">{initials}</span><span className="user-menu__copy"><strong>{currentUser.name}</strong><small>{ownerAccess ? "Platform owner" : currentUser.tornUserId ? "Faction member" : "Not connected"}</small></span><ChevronDown size={14} />
              </button>
              {openPanel === "user" && (
                <TopbarPopover className="topbar-popover--user" close={() => setOpenPanel(null)}>
                  <div className="user-popover-profile" title={currentUser.tornUserId ? `Torn user ID ${currentUser.tornUserId}` : undefined}><span className="user-menu__avatar">{initials}</span><span><strong>{currentUser.name}</strong><small>{ownerAccess ? "Platform owner" : currentUser.tornUserId ? "Verified Torn identity" : "No verified Torn identity"}</small></span></div>
                  {ownerAccess && <Link href="/admin" onClick={() => setOpenPanel(null)}><ShieldCheck size={14} /> Owner administration</Link>}
                  <Link href="/settings" onClick={() => setOpenPanel(null)}><Settings size={14} /> Workspace settings</Link>
                  <button onClick={toggleDensity}><MonitorCog size={14} /> {compact ? "Comfortable density" : "Compact density"}<small>{compact ? "Roomier" : "More rows"}</small></button>
                  {currentUser.tornUserId
                    ? <button onClick={() => void disconnectWorkspace()}><LogOut size={14} /> Disconnect Torn API</button>
                    : <Link href="/connect" onClick={() => setOpenPanel(null)}><KeyRound size={14} /> Connect Torn API</Link>}
                </TopbarPopover>
              )}
            </div>
          </div>
        </header>

        <div className={`data-source-banner data-source-banner--${liveTelemetry.mode === "offline" ? "offline" : liveTelemetry.source}`} role="status"><span>{liveTelemetry.mode === "offline" ? "Offline test data" : liveTelemetry.source === "live" ? "Verified Torn workspace" : "Connection required"}</span>{liveTelemetry.message}</div>
        <RouteProgress />
        {/* The workspace scrolls inside this element rather than the document,
            so the top bar and the provenance banner stay fixed and the
            scrollbar spans only the content beneath them. */}
        <div className="app-scroll" ref={scrollRef}>
          <main className="page-content">{children}</main>
        </div>
      </div>

      {openPanel === "health" && (
        <ServiceStateDrawer
          telemetry={liveTelemetry}
          database={database}
          syncing={syncing}
          onSync={() => void syncWorkspace()}
          onClose={() => setOpenPanel(null)}
        />
      )}

      {commandOpen && (
        <div className="command-layer" role="dialog" aria-modal="true" aria-label="Command palette">
          <button className="command-layer__scrim" onClick={() => setCommandOpen(false)} aria-label="Close command palette" />
          <section className="command-palette">
            <label><Search size={19} /><input autoFocus value={commandQuery} onChange={(event) => { setCommandQuery(event.target.value); setCommandIndex(0); }} onKeyDown={handleCommandKey} placeholder="Jump to a page or search workspace…" /><kbd>Esc</kbd></label>
            <div className="command-palette__label">Navigation</div>
            <div className="command-results">
              {filteredCommands.map((item, index) => { const Icon = item.icon; return <button key={item.href} className={index === commandIndex ? "command-result--selected" : undefined} onMouseEnter={() => setCommandIndex(index)} onClick={() => goTo(item)}><span><Icon size={16} /></span><strong>{item.label}</strong>{item.badge && <em>{item.badge}</em>}<kbd>{item.shortcut ?? "↵"}</kbd></button>; })}
              {filteredCommands.length === 0 && <div className="command-empty"><Sparkles size={18} /><strong>No matching destination</strong><small>Try “payouts”, “members”, or “settings”.</small></div>}
            </div>
            <footer><span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
          </section>
        </div>
      )}

      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => <Toast key={toast.id} toast={toast} onClose={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} />)}
      </div>
    </div>
  );
}

function TopbarPopover({ children, className, close }: { children: ReactNode; className: string; close: () => void }) {
  return <><button className="topbar-popover-scrim" aria-label="Close menu" onClick={close} /><div className={`topbar-popover ${className}`}>{children}</div></>;
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  const icons: Record<ToastTone, LucideIcon> = { success: Check, info: Gauge, warning: Clock3, danger: X };
  const Icon = icons[toast.tone ?? "info"];
  return <div className={`toast toast--${toast.tone ?? "info"}`}><span><Icon size={15} /></span><div><strong>{toast.title}</strong>{toast.description && <small>{toast.description}</small>}</div><button onClick={onClose} aria-label="Dismiss"><X size={14} /></button></div>;
}

function checkedTimeLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Check time unavailable";
  return `Checked ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(timestamp)}`;
}

function newestTelemetry(server: WorkspaceTelemetry, override: WorkspaceTelemetry | null): WorkspaceTelemetry {
  if (!override) return server;
  const serverTime = Date.parse(server.checkedAt);
  const overrideTime = Date.parse(override.checkedAt);
  return Number.isFinite(serverTime) && serverTime > overrideTime ? server : override;
}

function isWorkspaceTelemetry(value: unknown): value is WorkspaceTelemetry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkspaceTelemetry>;
  return (candidate.source === "live" || candidate.source === "unavailable")
    && typeof candidate.checkedAt === "string"
    && typeof candidate.message === "string"
    && (candidate.faction === null || typeof candidate.faction === "object")
    && (candidate.chain === null || typeof candidate.chain === "object");
}
