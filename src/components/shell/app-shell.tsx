"use client";

import {
  Activity,
  AlarmClock,
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Command,
  Crosshair,
  Gauge,
  History,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
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
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { BrandMark } from "@/components/brand-mark";
import { AdminWorkspaceNavigation, AdminWorkspaceNavigationProvider } from "@/components/admin/admin-workspace-navigation";
import { UpgradeAccess } from "@/components/licensing/upgrade-access";
import { useMemberActivityMonitor } from "@/components/members/use-member-activity-monitor";
import { AboutDialog } from "@/components/shell/about-dialog";
import {
  LiveWorkspaceTelemetryProvider,
  usePersistentChainCountdown,
} from "@/components/shell/live-workspace-telemetry";
import { ProfileMenu } from "@/components/shell/profile-menu";
import { NavigationBeacon, publishNavigationState, RouteProgress } from "@/components/shell/route-progress";
import { ServiceStateDrawer } from "@/components/shell/service-state-drawer";
import {
  hasWorkspaceSectionNavigation,
  WorkspaceSectionNavigation,
  WorkspaceSectionNavigationProvider,
} from "@/components/shell/workspace-section-navigation";
import { StatusDot } from "@/components/ui/status-dot";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/ui/user-avatar";
import { applyAppearancePreferences, saveAppearancePreferences, useAppearancePreferences } from "@/lib/appearance-preferences";
import { PLATFORM_OWNER, type PlatformActor } from "@/lib/auth/platform-owner";
import { enqueueToast, notify, toastDurationMs, toastKey, type ToastDetail, type ToastQueueItem, type ToastTone } from "@/lib/client-actions";
import type { DatabaseStatus } from "@/lib/data/database-status";
import type { FactionAccessSummary } from "@/lib/licensing/types";
import { getLicenseRenewalNotice } from "@/lib/licensing/renewal";
import type { MemberActivityMonitorSnapshot } from "@/lib/members/member-activity-intelligence";
import {
  ensureNotificationWorker,
  getBrowserNotificationPermission,
  isNotificationQuietTime,
  showDeviceNotification,
  useMemberNotificationPreferences,
} from "@/lib/member-notification-preferences";
import { buildOperationalNotifications, type OperationalNotification } from "@/lib/notifications/notification-intelligence";
import { pollSecondsForChain } from "@/lib/torn/polling-policy";
import { isWorkspaceTelemetry, requestWorkspaceTelemetry } from "@/lib/torn/telemetry-client";
import { readWorkspaceTelemetryEvent, workspaceTelemetryEvent } from "@/lib/torn/telemetry-events";
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
      { label: "Watch schedule", href: "/chain-watch", icon: AlarmClock, shortcut: "G W", requiresLicense: true },
      { label: "Members", href: "/members", icon: Users, shortcut: "G M", requiresLicense: true },
      { label: "Targets", href: "/targets", icon: Crosshair, shortcut: "G T", requiresLicense: true },
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

export function AppShell({ children, currentUser, telemetry, access, workspaceAuthorized, database, memberActivityAlert }: { children: ReactNode; currentUser: PlatformActor; telemetry: WorkspaceTelemetry; access: FactionAccessSummary; workspaceAuthorized: boolean; database: DatabaseStatus; memberActivityAlert: MemberActivityMonitorSnapshot | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const preferences = useAppearancePreferences();
  const deviceAlertPreferences = useMemberNotificationPreferences();
  const collapsed = preferences.sidebarCollapsed;
  const compact = preferences.compact;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const commandListId = useId();
  const commandInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLButtonElement>(null);
  const commandReturnFocusRef = useRef<HTMLElement | null>(null);
  const [telemetryOverride, setTelemetryOverride] = useState<WorkspaceTelemetry | null>(null);
  const [syncState, setSyncState] = useState<"syncing" | "failed" | null>(null);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const monitoredActivity = useMemberActivityMonitor(memberActivityAlert);
  const liveTelemetry = newestTelemetry(telemetry, telemetryOverride);
  const { seconds: chainSeconds, deadlineAtSeconds, nowSeconds, applyReading } = usePersistentChainCountdown(liveTelemetry);
  const latestTelemetryRef = useRef(liveTelemetry);
  const chainAlertInFlightRef = useRef<string | null>(null);
  const syncLabel = syncState === "syncing"
    ? "Syncing..."
    : syncState === "failed"
      ? "Check failed"
      : checkedTimeLabel(liveTelemetry.checkedAt);
  const renewalNotice = workspaceAuthorized && access.state === "active" ? getLicenseRenewalNotice(access.expiresAt) : null;
  const renewalNotification: OperationalNotification | null = renewalNotice?.renewalOpen ? {
    // Include the countdown step so a notice acknowledged at seven days is
    // surfaced again as the paid-through date approaches.
    id: `access:${access.expiresAt ?? "expired"}:${renewalNotice.daysRemaining ?? renewalNotice.phase}`,
    category: "access",
    title: renewalNotice.title,
    detail: access.renewalRequest ? `Renewal ${access.renewalRequest.reference} is awaiting owner review.` : renewalNotice.detail,
    tone: renewalNotice.phase === "urgent" || renewalNotice.phase === "final-day" || renewalNotice.phase === "expired" ? "danger" : "warning",
    priority: renewalNotice.phase === "final-day" || renewalNotice.phase === "expired" ? 110 : renewalNotice.phase === "urgent" ? 95 : 75,
    checkedAt: liveTelemetry.checkedAt,
    href: "/unlock",
  } : null;
  const systemNotifications = [...buildOperationalNotifications({ telemetry: liveTelemetry, chainWarningSeconds: preferences.chainWarningSeconds, chainRemainingSeconds: chainSeconds, memberActivity: monitoredActivity }), ...(renewalNotification ? [renewalNotification] : [])]
    .toSorted((left, right) => right.priority - left.priority);
  const notifications = systemNotifications.map((item) => ({ ...item, unread: !readNotificationIds.includes(item.id) }));
  const activeNotificationIdsKey = JSON.stringify(systemNotifications.map((item) => item.id).toSorted());
  const notificationScope = String(liveTelemetry.faction?.id ?? "global");
  const [toasts, setToasts] = useState<ToastQueueItem[]>([]);
  const toastTimersRef = useRef(new Map<string, number>());
  const faction = liveTelemetry.faction;
  const chain = liveTelemetry.chain;
  const offlineMode = liveTelemetry.mode === "offline";
  const workspaceLocked = !workspaceAuthorized;
  const ownerAccess = currentUser.isPlatformAdmin && currentUser.tornUserId === PLATFORM_OWNER.tornUserId;
  const adminRoute = ownerAccess && (pathname === "/admin" || pathname.startsWith("/admin/"));
  const workspaceNavigationRoute = hasWorkspaceSectionNavigation(pathname);
  const visibleNavigation = navigation
    .filter((group) => group.label !== "Platform" || ownerAccess)
    .map((group) => ({ ...group, items: group.items.map((item) => {
      if (workspaceLocked && item.requiresLicense) return { ...item, locked: true, badge: "Locked" };
      if (item.href === "/live-chain") return { ...item, badge: chain ? chain.current.toLocaleString() : "—" };
      if (item.href === "/members" && monitoredActivity?.attentionCount) return { ...item, badge: monitoredActivity.attentionCount.toLocaleString() };
      return item;
    }) }));
  const searchableItems = visibleNavigation.flatMap((group) => group.items);
  const mobileNavigation: NavigationItem[] = workspaceLocked
    ? [
        { label: "Access", href: "/unlock", icon: LockKeyhole },
        { label: "Settings", href: "/settings", icon: SlidersHorizontal },
        { label: "Connect", href: "/connect", icon: KeyRound },
      ]
    : ["/dashboard", "/live-chain", "/members", "/payouts"]
        .map((href) => searchableItems.find((item) => item.href === href))
        .filter((item): item is NavigationItem => Boolean(item));
  const mobileNavigationHasCurrentRoute = mobileNavigation.some((item) =>
    pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)),
  );
  // Keyboard shortcuts must not resubscribe on every render, so the latest
  // destinations are read through a ref instead of an effect dependency.
  const searchableItemsRef = useRef(searchableItems);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [navigating, startNavigation] = useTransition();
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
  const closeAbout = useCallback(() => {
    setAboutOpen(false);
    window.requestAnimationFrame(() => userMenuRef.current?.focus());
  }, []);
  const normalizedCommandQuery = commandQuery.trim().toLowerCase();
  const filteredCommands = normalizedCommandQuery
    ? searchableItems.filter((item) => item.label.toLowerCase().includes(normalizedCommandQuery))
    : searchableItems;

  const markNotificationsRead = useCallback((ids: readonly string[]) => {
    setReadNotificationIds((current) => {
      const next = [...new Set([...current, ...ids])];
      saveReadNotificationIds(notificationScope, next);
      return next;
    });
  }, [notificationScope]);

  const openCommandPalette = useCallback(() => {
    if (!commandOpen) {
      commandReturnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    }
    setOpenPanel(null);
    setCommandOpen(true);
  }, [commandOpen]);

  const closeCommandPalette = useCallback(() => {
    setCommandOpen(false);
    setCommandQuery("");
    setCommandIndex(0);
    const returnTarget = commandReturnFocusRef.current;
    commandReturnFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (returnTarget?.isConnected) returnTarget.focus();
    });
  }, []);

  useEffect(() => {
    applyAppearancePreferences(preferences);
  }, [preferences]);

  // Update existing workers for every member, including removal of the legacy
  // avatar cache, regardless of their notification preferences.
  useEffect(() => {
    void ensureNotificationWorker();
  }, []);

  useEffect(() => {
    latestTelemetryRef.current = liveTelemetry;
  }, [liveTelemetry]);

  useEffect(() => {
    const root = document.documentElement;
    // Excludes exactly 0: once the timer runs out, the accent must release
    // immediately rather than staying red while a stale "active" reading
    // waits on the next poll to confirm the chain actually ended.
    const critical = liveTelemetry.chain?.state === "active" && chainSeconds > 0 && chainSeconds <= 60;
    if (critical) root.dataset.chainDanger = "critical";
    else delete root.dataset.chainDanger;
    return () => { delete root.dataset.chainDanger; };
  }, [chainSeconds, liveTelemetry.chain?.state]);

  useEffect(() => {
    const currentChain = liveTelemetry.chain;
    if (!deviceAlertPreferences.enabled || !deviceAlertPreferences.includeChainAlerts || getBrowserNotificationPermission() !== "granted" || currentChain?.state !== "active") return;
    if (chainSeconds > deviceAlertPreferences.chainWarningSeconds) return;
    const critical = chainSeconds <= 60;
    if (!critical && isNotificationQuietTime(deviceAlertPreferences)) return;
    const resetMarker = currentChain.current >= 10 ? String(currentChain.current) : "warmup";
    const eventKey = `${currentChain.id}:${resetMarker}:${critical ? "critical" : "warning"}`;
    const storageKey = `chainward:chain-device-alert:v1:${liveTelemetry.faction?.id ?? "global"}`;
    if (chainAlertInFlightRef.current === eventKey || readChainAlertKey(storageKey) === eventKey) return;
    chainAlertInFlightRef.current = eventKey;
    void showDeviceNotification(
      critical ? `Chain critical · ${formatChainCountdown(chainSeconds)}` : `Chain warning · ${formatChainCountdown(chainSeconds)}`,
      {
        body: `${liveTelemetry.faction?.name ?? "Your faction"}: ${currentChain.current.toLocaleString()} / ${currentChain.maximum.toLocaleString()} hits. Open the live chain now.`,
        icon: "/icons/android-chrome-192x192.png",
        badge: "/icons/favicon-32x32.png",
        tag: `chainward-chain-${liveTelemetry.faction?.id ?? "global"}-${currentChain.id}`,
        requireInteraction: critical && deviceAlertPreferences.keepCriticalVisible,
        data: { url: "/live-chain" },
      },
    ).then((shown) => {
      if (shown) saveChainAlertKey(storageKey, eventKey);
    }).finally(() => {
      if (chainAlertInFlightRef.current === eventKey) chainAlertInFlightRef.current = null;
    });
  }, [chainSeconds, deviceAlertPreferences, liveTelemetry.chain, liveTelemetry.faction]);

  useEffect(() => {
    const timer = window.setTimeout(() => setReadNotificationIds(loadReadNotificationIds(notificationScope)), 0);
    return () => window.clearTimeout(timer);
  }, [notificationScope]);

  // Once a condition clears, forget its read acknowledgement. If the same
  // chain or member condition genuinely returns later, it should be unread.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const activeIds = new Set<string>(JSON.parse(activeNotificationIdsKey) as string[]);
      setReadNotificationIds((current) => {
        const next = current.filter((id) => activeIds.has(id));
        if (next.length !== current.length) saveReadNotificationIds(notificationScope, next);
        return next.length === current.length ? current : next;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeNotificationIdsKey, notificationScope]);

  useEffect(() => {
    searchableItemsRef.current = searchableItems;
  }, [searchableItems]);

  // Next restores scroll on the document, which no longer scrolls. Without this
  // a new route would open at the previous view's scroll offset.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  const publishTelemetry = useCallback((next: WorkspaceTelemetry, transitMs = 0) => {
    window.dispatchEvent(workspaceTelemetryEvent(next, transitMs));
  }, []);

  useEffect(() => {
    function receiveTelemetry(event: Event): void {
      const update = readWorkspaceTelemetryEvent(event);
      const next = update.telemetry;
      if (!isWorkspaceTelemetry(next)) return;
      if (!shouldAcceptTelemetry(latestTelemetryRef.current, next)) return;
      latestTelemetryRef.current = next;
      setTelemetryOverride((current) => newestTelemetry(next, current));
      applyReading(next, update.transitMs);
      setSyncState(null);
    }
    window.addEventListener("chainward:telemetry", receiveTelemetry);
    return () => window.removeEventListener("chainward:telemetry", receiveTelemetry);
  }, [applyReading]);

  // Torn resets the timeout at hit 10 and on every hit thereafter, so a slow
  // workspace cadence can leave the countdown far behind the game.
  const chainRunning = liveTelemetry.chain?.state === "active";
  const pollSeconds = pollSecondsForChain(chainRunning, preferences.refreshIntervalSeconds);

  useEffect(() => {
    if (!preferences.autoRefresh) return;
    let stopped = false;
    let pollInFlight = false;
    let lastPollAt = Date.now();

    async function pollTelemetry(forceFresh = chainRunning): Promise<void> {
      if (!navigator.onLine || document.visibilityState !== "visible" || pollInFlight) return;
      pollInFlight = true;
      lastPollAt = Date.now();
      try {
        // Torn documents `timestamp` as the supported way to bypass its
        // 30-second service cache when fresh information is needed. The server
        // adds it only while a chain is active, and only to the chain request.
        const endpoint = forceFresh ? "/api/telemetry/live-chain?fresh=1" : "/api/telemetry/live-chain";
        const result = await requestWorkspaceTelemetry(endpoint);
        if (!result.ok || !isWorkspaceTelemetry(result.payload) || stopped) return;
        publishTelemetry(result.payload, result.transitMs);
      } catch {
        // A background poll keeps the last verified snapshot; manual sync reports failures.
      } finally {
        pollInFlight = false;
      }
    }

    // Browsers may throttle timers in a background tab. A focus event catches
    // up immediately when that throttling delayed the normal scheduler.
    function refreshOnFocus(): void {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastPollAt < pollSeconds * 1_000) return;
      void pollTelemetry();
    }

    const interval = window.setInterval(() => void pollTelemetry(), pollSeconds * 1_000);
    // The first reading must be uncached even when the server snapshot says the
    // faction is idle: that snapshot can itself pre-date a newly started chain.
    // Once the current state is known, active chains retain the five-second
    // safety cadence and idle workspaces return to the saved interval.
    void pollTelemetry(true);
    document.addEventListener("visibilitychange", refreshOnFocus);
    window.addEventListener("online", refreshOnFocus);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      window.removeEventListener("online", refreshOnFocus);
    };
  }, [chainRunning, preferences.autoRefresh, pollSeconds, publishTelemetry]);

  useEffect(() => {
    let navigationPrefix = false;
    let prefixTimer: number | undefined;
    function openCommand(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommandPalette();
        return;
      }
      if (event.key === "Escape") {
        closeCommandPalette();
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
          startNavigation(() => router.push(destination.locked ? "/unlock" : destination.href));
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
  }, [closeCommandPalette, openCommandPalette, router, startNavigation]);

  useEffect(() => {
    function receiveToast(event: Event): void {
      const detail = (event as CustomEvent<ToastDetail>).detail;
      if (!detail?.title?.trim()) return;
      const key = toastKey(detail);
      const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const previousTimer = toastTimersRef.current.get(key);
      if (previousTimer) {
        window.clearTimeout(previousTimer);
        toastTimersRef.current.delete(key);
      }
      setToasts((current) => enqueueToast(current, detail, id));
      const duration = toastDurationMs(detail);
      if (duration > 0) {
        const timer = window.setTimeout(() => {
          setToasts((current) => current.filter((toast) => toast.key !== key));
          toastTimersRef.current.delete(key);
        }, duration);
        toastTimersRef.current.set(key, timer);
      }
    }
    window.addEventListener("chainward:toast", receiveToast);
    const timers = toastTimersRef.current;
    return () => {
      window.removeEventListener("chainward:toast", receiveToast);
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  function goTo(item: NavigationItem): void {
    commandReturnFocusRef.current = null;
    setCommandOpen(false);
    setCommandQuery("");
    startNavigation(() => router.push(item.locked ? "/unlock" : item.href));
  }

  function handleCommandKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeCommandPalette();
      return;
    }
    if (event.key === "Tab") {
      // Results use the standard combobox active-descendant pattern, so focus
      // remains on the search field while arrows select an option.
      event.preventDefault();
      commandInputRef.current?.focus();
      return;
    }
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
      const result = await requestWorkspaceTelemetry("/api/telemetry/live-chain?fresh=1");
      if (!result.ok || !isWorkspaceTelemetry(result.payload)) throw new Error("Telemetry sync failed");
      const payload = result.payload;
      publishTelemetry(payload, result.transitMs);
      router.refresh();
      notify({
        title: payload.source === "live" ? "Live Torn data refreshed" : "Torn data unavailable",
        description: payload.source === "live" ? "Torn returned an uncached chain snapshot." : payload.message,
        tone: payload.source === "live" ? "success" : "warning",
      });
    } catch {
      setSyncState("failed");
      notify({ title: "Workspace sync failed", description: "Existing values were retained safely.", tone: "danger" });
    }
  }

  async function disconnectWorkspace(): Promise<void> {
    setOpenPanel(null);
    publishNavigationState("disconnect-workspace", true);
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
    } finally {
      publishNavigationState("disconnect-workspace", false);
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
      <aside id="workspace-navigation" className={`sidebar${mobileOpen ? " sidebar--mobile-open" : ""}`}>
        <div className="sidebar__brand-row">
          <Link href={workspaceLocked ? "/unlock" : "/dashboard"} className="sidebar__brand-link" aria-label={workspaceLocked ? "Chainward workspace locked — view unlock status" : "Chainward overview"}><BrandMark /></Link>
          <button className="icon-button sidebar__mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>

        <button className="sidebar-rail-toggle" onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>

        <button className="sidebar-command" onClick={openCommandPalette}>
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

      <WorkspaceSectionNavigationProvider pathname={pathname}>
      <AdminWorkspaceNavigationProvider active={adminRoute}>
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
            <UpgradeAccess access={access} workspaceAuthorized={workspaceAuthorized} />
            <button className="topbar-command" onClick={openCommandPalette}><Command size={14} /><span>Quick find</span><kbd>⌘K</kbd></button>
            <button className={`data-status-control data-status-control--${offlineMode ? "offline" : liveTelemetry.source}`} onClick={() => void syncWorkspace()} disabled={syncing || workspaceLocked} aria-label={workspaceLocked ? "Live sync unlocks with the operational workspace" : `Refresh workspace data. Last server check: ${new Date(liveTelemetry.checkedAt).toLocaleString("en-GB")}`} title={workspaceLocked ? "Live sync unlocks with the operational workspace" : `Last server check: ${new Date(liveTelemetry.checkedAt).toLocaleString("en-GB")}`}>
              <StatusDot tone={liveTelemetry.source === "live" ? "success" : "warning"} pulse={liveTelemetry.source === "live" && !syncing} />
              <span><strong>{offlineMode ? "Offline fixture" : liveTelemetry.source === "live" ? "Server check" : "API attention"}</strong><small>{syncLabel}</small></span>
              {syncing ? <Spinner size={14} label="Syncing Torn data" /> : <Clock3 size={14} aria-hidden="true" />}
            </button>
            <div className="topbar-popover-wrap">
              <button className="icon-button notification-button" onClick={() => setOpenPanel(openPanel === "notifications" ? null : "notifications")} aria-label="Notifications" aria-expanded={openPanel === "notifications"}>
                <Bell size={18} />{unreadCount > 0 && <span className="notification-button__badge">{unreadCount}</span>}
              </button>
              {openPanel === "notifications" && (
                <TopbarPopover className="topbar-popover--notifications" close={() => setOpenPanel(null)}>
                  <div className="popover-heading popover-heading--action"><span>Notifications {unreadCount > 0 && <em>{unreadCount} new</em>}</span><button disabled={unreadCount === 0} onClick={() => markNotificationsRead(notifications.map((item) => item.id))}>Mark all read</button></div>
                  <div className="notification-list">
                    {notifications.map((item) => <button className={item.unread ? "notification-item--unread" : undefined} key={item.id} onClick={() => { markNotificationsRead([item.id]); if (item.href) { const href = item.href; setOpenPanel(null); startNavigation(() => router.push(href)); } }}><i className={`notification-tone notification-tone--${item.tone}`} /><span><span className="notification-context">{notificationCategoryLabel(item.category)}<time dateTime={item.checkedAt}>{notificationTimeLabel(item.checkedAt)}</time></span><strong>{item.title}</strong><small>{item.detail}</small></span>{item.unread && <em aria-label="Unread" />}</button>)}
                    {notifications.length === 0 && <div className="notification-empty"><Bell size={20} /><strong>You&apos;re all caught up</strong><small>No connection, access, chain, or member conditions need attention.</small></div>}
                  </div>
                  {ownerAccess && <Link href="/admin" onClick={() => setOpenPanel(null)} className="popover-action">Open owner operations <span>→</span></Link>}
                </TopbarPopover>
              )}
            </div>
            <div className="topbar-popover-wrap">
              <button ref={userMenuRef} className="user-menu" onClick={() => setOpenPanel(openPanel === "user" ? null : "user")} aria-label="Open user menu" aria-expanded={openPanel === "user"}>
                <span className="user-menu__avatar"><UserAvatar className="user-avatar__image" imageUrl={currentUser.profileImageUrl} name={currentUser.name} size={30} /></span><span className="user-menu__copy"><strong>{currentUser.name}</strong><small>{ownerAccess ? "Platform owner" : currentUser.tornUserId ? "Faction member" : "Not connected"}</small></span><ChevronDown size={14} />
              </button>
              {openPanel === "user" && (
                <TopbarPopover className="topbar-popover--user" close={() => setOpenPanel(null)}>
                  <ProfileMenu
                    actor={currentUser}
                    compact={compact}
                    ownerAccess={ownerAccess}
                    onClose={() => setOpenPanel(null)}
                    onDisconnect={() => void disconnectWorkspace()}
                    onOpenAbout={() => { setOpenPanel(null); setAboutOpen(true); }}
                    onToggleDensity={toggleDensity}
                  />
                </TopbarPopover>
              )}
            </div>
          </div>
        </header>

        {adminRoute ? <AdminWorkspaceNavigation /> : workspaceNavigationRoute ? <WorkspaceSectionNavigation pathname={pathname} /> : (
          <div className={`data-source-banner data-source-banner--${liveTelemetry.mode === "offline" ? "offline" : liveTelemetry.source}`} role="status">
            <span className="data-source-banner__label">{liveTelemetry.mode === "offline" ? "Offline test data" : liveTelemetry.source === "live" ? "Verified Torn workspace" : "Connection required"}</span>
            <span className="data-source-banner__message" title={liveTelemetry.message}>{liveTelemetry.message}</span>
          </div>
        )}
        <RouteProgress />
        {/* The workspace scrolls inside this element rather than the document,
            so the top bar and its route-specific strip stay fixed and the
            scrollbar spans only the content beneath them. */}
        <div className="app-scroll" ref={scrollRef}>
          <main className="page-content">
            {renewalNotice?.renewalOpen && <Link className={`license-expiry-banner license-expiry-banner--${renewalNotice.phase}`} href="/unlock"><span><Clock3 size={18} /></span><p><strong>{access.renewalRequest ? "Renewal awaiting owner review" : renewalNotice.title}</strong><small>{access.renewalRequest ? `Current access remains open while ${access.renewalRequest.reference} is reviewed.` : renewalNotice.detail}</small></p><b>{access.renewalRequest ? "View request" : "Renew access"}<ArrowRight size={14} /></b></Link>}
            <LiveWorkspaceTelemetryProvider value={{
              telemetry: liveTelemetry,
              seconds: chainSeconds,
              deadlineAtSeconds,
              nowSeconds,
            }}>
              {children}
            </LiveWorkspaceTelemetryProvider>
          </main>
        </div>
      </div>
      </AdminWorkspaceNavigationProvider>
      </WorkspaceSectionNavigationProvider>

      <nav className="mobile-tabbar" aria-label="Mobile workspace navigation">
        {mobileNavigation.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
          const Icon = item.icon;
          const label = item.label === "Payout ledger" ? "Payouts" : item.label;
          return (
            <Link
              href={item.href}
              key={item.href}
              aria-current={active ? "page" : undefined}
              className={`mobile-tabbar__item${active ? " mobile-tabbar__item--active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <span><Icon size={20} strokeWidth={1.8} /></span>
              <small>{label}</small>
              <NavigationBeacon id={`mobile-${item.href}`} />
            </Link>
          );
        })}
        <button
          type="button"
          className={`mobile-tabbar__item${mobileOpen || !mobileNavigationHasCurrentRoute ? " mobile-tabbar__item--active" : ""}`}
          aria-current={!mobileNavigationHasCurrentRoute ? "page" : undefined}
          aria-expanded={mobileOpen}
          aria-controls="workspace-navigation"
          onClick={() => {
            saveAppearancePreferences({ sidebarCollapsed: false });
            setMobileOpen(true);
          }}
        >
          <span><Menu size={20} strokeWidth={1.8} /></span>
          <small>More</small>
        </button>
      </nav>

      {openPanel === "health" && (
        <ServiceStateDrawer
          telemetry={liveTelemetry}
          database={database}
          autoRefresh={preferences.autoRefresh}
          refreshIntervalSeconds={preferences.refreshIntervalSeconds}
          chainRunning={chainRunning}
          syncing={syncing}
          onSync={() => void syncWorkspace()}
          onClose={() => setOpenPanel(null)}
        />
      )}

      {commandOpen && (
        <div className="command-layer" role="dialog" aria-modal="true" aria-label="Command palette">
          <button type="button" tabIndex={-1} className="command-layer__scrim" onClick={closeCommandPalette} aria-label="Close command palette" />
          <section className="command-palette">
            <label><Search size={19} /><input ref={commandInputRef} autoFocus role="combobox" aria-label="Search workspace" aria-autocomplete="list" aria-expanded="true" aria-controls={commandListId} aria-activedescendant={filteredCommands[commandIndex] ? `${commandListId}-option-${commandIndex}` : undefined} value={commandQuery} onChange={(event) => { setCommandQuery(event.target.value); setCommandIndex(0); }} onKeyDown={handleCommandKey} placeholder="Jump to a page or search workspace…" /><kbd>Esc</kbd></label>
            <div className="command-palette__label">Navigation</div>
            <div id={commandListId} className="command-results" role="listbox" aria-label="Workspace destinations">
              {filteredCommands.map((item, index) => { const Icon = item.icon; return <button type="button" tabIndex={-1} role="option" aria-selected={index === commandIndex} id={`${commandListId}-option-${index}`} key={item.href} className={index === commandIndex ? "command-result--selected" : undefined} onMouseEnter={() => setCommandIndex(index)} onClick={() => goTo(item)}><span><Icon size={16} /></span><strong>{item.label}</strong>{item.badge && <em>{item.badge}</em>}<kbd>{item.shortcut ?? "↵"}</kbd></button>; })}
              {filteredCommands.length === 0 && <div className="command-empty"><Sparkles size={18} /><strong>No matching destination</strong><small>Try “payouts”, “members”, or “settings”.</small></div>}
            </div>
            <footer><span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
          </section>
        </div>
      )}

      <AboutDialog open={aboutOpen} onClose={closeAbout} />

      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => <Toast key={toast.id} toast={toast} onClose={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} />)}
      </div>
    </div>
  );
}

function TopbarPopover({ children, className, close }: { children: ReactNode; className: string; close: () => void }) {
  return <><button className="topbar-popover-scrim" aria-label="Close menu" onClick={close} /><div className={`topbar-popover ${className}`}>{children}</div></>;
}

function Toast({ toast, onClose }: { toast: ToastQueueItem; onClose: () => void }) {
  const icons: Record<ToastTone, LucideIcon> = { success: Check, info: Gauge, warning: Clock3, danger: X };
  const Icon = icons[toast.tone ?? "info"];
  return <div className={`toast toast--${toast.tone ?? "info"}`} role={toast.tone === "danger" ? "alert" : "status"} aria-atomic="true"><span><Icon size={15} /></span><div><strong>{toast.title}{toast.count > 1 && <em>×{toast.count}</em>}</strong>{toast.description && <small>{toast.description}</small>}</div><button onClick={onClose} aria-label={`Dismiss ${toast.title}`}><X size={14} /></button></div>;
}

function notificationCategoryLabel(category: "connection" | "chain" | "members" | "access"): string {
  if (category === "access") return "Faction access";
  if (category === "chain") return "Live chain";
  if (category === "members") return "Member monitor";
  return "Connection";
}

function notificationTimeLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function loadReadNotificationIds(scope: string): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(`chainward:notification-read:v2:${scope}`) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(-100) : [];
  } catch {
    return [];
  }
}

function saveReadNotificationIds(scope: string, ids: readonly string[]): void {
  try { window.localStorage.setItem(`chainward:notification-read:v2:${scope}`, JSON.stringify(ids.slice(-100))); }
  catch { /* Read state remains valid for this page when storage is blocked. */ }
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

function shouldAcceptTelemetry(current: WorkspaceTelemetry, incoming: WorkspaceTelemetry): boolean {
  const currentTime = Date.parse(current.checkedAt);
  const incomingTime = Date.parse(incoming.checkedAt);
  if (Number.isFinite(currentTime) && Number.isFinite(incomingTime) && incomingTime < currentTime) return false;
  if (incomingTime !== currentTime) return true;
  const currentChain = current.chain;
  const incomingChain = incoming.chain;
  if (!currentChain || !incomingChain) return Boolean(incomingChain) || !currentChain;
  if (currentChain.id !== incomingChain.id || currentChain.state !== incomingChain.state) return true;
  return incomingChain.current >= currentChain.current;
}

function formatChainCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function readChainAlertKey(storageKey: string): string | null {
  try { return window.localStorage.getItem(storageKey); }
  catch { return null; }
}

function saveChainAlertKey(storageKey: string, eventKey: string): void {
  try { window.localStorage.setItem(storageKey, eventKey); }
  catch { /* The persistent shell ref still deduplicates this page lifetime. */ }
}
