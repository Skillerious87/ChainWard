"use client";

import { Activity, AlertTriangle, BellOff, BellRing, Check, ChevronLeft, ChevronRight, Clipboard, Clock3, Copy, Database, DatabaseBackup, Download, Eye, EyeOff, HardDrive, KeyRound, LockKeyhole, Palette, Play, RefreshCw, ServerCog, ShieldCheck, SlidersHorizontal, Unlock, Upload, FlaskConical, Lock, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { publishViewSwitch } from "@/components/shell/route-progress";
import { lockWorkspaceForTesting, unlockWorkspaceForTesting } from "@/app/(platform)/settings/actions";
import { accentOptions, saveAppearancePreferences, useAppearancePreferences, type AccentOption } from "@/lib/appearance-preferences";
import { notify } from "@/lib/client-actions";
import type { DatabaseStatus } from "@/lib/data/database-status";
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  saveMemberNotificationPreferences,
  showWindowsNotification,
  useMemberNotificationPreferences,
  type BrowserNotificationPermission,
  type MemberNotificationIntervalMinutes,
  type MemberNotificationReminderHours,
} from "@/lib/member-notification-preferences";
import type { WorkspaceTelemetry } from "@/lib/torn/telemetry-types";

type SettingsView = "connection" | "operations" | "notifications" | "appearance" | "storage" | "postgresql" | "privacy" | "developer";

export interface LicenceTestingContext {
  locked: boolean;
  label: string;
  factionName: string | null;
}
const baseViews: { id: SettingsView; label: string; description: string; icon: LucideIcon }[] = [
  { id: "connection", label: "Torn connection", description: "Identity and API status", icon: KeyRound },
  { id: "operations", label: "Live operations", description: "Refresh and chain alerts", icon: Activity },
  { id: "notifications", label: "Member alerts", description: "Windows notifications and monitoring", icon: BellRing },
  { id: "appearance", label: "Appearance", description: "Density, contrast, and colour", icon: Palette },
  { id: "storage", label: "Storage & backups", description: "Local database and restore", icon: Database },
  { id: "postgresql", label: "PostgreSQL", description: "Shared database setup", icon: ServerCog },
  { id: "privacy", label: "Data & privacy", description: "What Chainward stores", icon: ShieldCheck },
];

/** Only appended when the licence testing controls are available. */
const developerView = { id: "developer" as const, label: "Developer tools", description: "Review the locked workspace", icon: FlaskConical };

interface PostgresForm {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

interface PostgresTestResult {
  database: string;
  user: string;
  serverVersion: string;
  latencyMs: number;
}

export function WorkspaceSettings({ telemetry, database, canMonitorMembers, licenceTesting = null }: { telemetry: WorkspaceTelemetry; database: DatabaseStatus; canMonitorMembers: boolean; licenceTesting?: LicenceTestingContext | null }) {
  const router = useRouter();
  const preferences = useAppearancePreferences();
  const notificationPreferences = useMemberNotificationPreferences();
  const [activeView, setActiveView] = useState<SettingsView>("connection");
  const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>("unsupported");
  const [notificationWorking, setNotificationWorking] = useState(false);
  const [licenceWorking, setLicenceWorking] = useState(false);
  const views = licenceTesting ? [...baseViews, developerView] : baseViews;
  const [storageWorking, setStorageWorking] = useState<"create" | "download" | "restore" | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [postgres, setPostgres] = useState<PostgresForm>({ host: "localhost", port: "5432", database: "chainward", user: "chainward", password: "chainward", ssl: false });
  const [showPostgresPassword, setShowPostgresPassword] = useState(false);
  const [postgresWorking, setPostgresWorking] = useState(false);
  const [postgresResult, setPostgresResult] = useState<PostgresTestResult | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const activeIndex = views.findIndex((view) => view.id === activeView);
  const active = views[activeIndex] ?? views[0]!;
  const ActiveIcon = active.icon;

  useEffect(() => {
    const timer = window.setTimeout(() => setNotificationPermission(getBrowserNotificationPermission()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function chooseAccent(color: AccentOption): void {
    saveAppearancePreferences({ accent: color });
    notify({ title: "Appearance saved", description: "The accent will stay active in this browser.", tone: "success" });
  }

  function toggleClass(name: "compact" | "highContrast" | "reducedEffects", value: boolean): void {
    saveAppearancePreferences({ [name]: value });
  }

  function updatePostgres<K extends keyof PostgresForm>(name: K, value: PostgresForm[K]): void {
    setPostgres((current) => ({ ...current, [name]: value }));
    setPostgresResult(null);
  }

  async function changeLicenceState(mode: "lock" | "unlock"): Promise<void> {
    setLicenceWorking(true);
    try {
      const result = mode === "lock" ? await lockWorkspaceForTesting() : await unlockWorkspaceForTesting();
      notify({
        title: result.ok ? (mode === "lock" ? "Workspace locked for testing" : "Access restored") : "Licence state unchanged",
        description: result.message,
        tone: result.ok ? (mode === "lock" ? "warning" : "success") : "danger",
      });
      if (result.ok) router.refresh();
    } finally { setLicenceWorking(false); }
  }

  function cycle(direction: -1 | 1): void {
    const next = Math.min(views.length - 1, Math.max(0, activeIndex + direction));
    selectView(views[next]!.id);
  }

  function selectView(next: SettingsView): void {
    if (next === activeView) return;
    publishViewSwitch(`settings:${next}`);
    setActiveView(next);
  }

  async function createDatabaseFile(): Promise<void> {
    setStorageWorking("create");
    try {
      const response = await fetch("/api/data/local-database", { method: "POST" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(isErrorPayload(payload) ? payload.error : "The database file could not be created.");
      const filename = isDatabasePayload(payload) ? payload.filename : "chainward-local.sqlite";
      notify({ title: "Local database created", description: `${filename} is ready for reward schemes and paid-chain records.`, tone: "success" });
      router.refresh();
    } catch (error) {
      notify({ title: "Database not created", description: error instanceof Error ? error.message : "Try again.", tone: "danger" });
    } finally { setStorageWorking(null); }
  }

  async function downloadBackup(): Promise<void> {
    setStorageWorking("download");
    try {
      const response = await fetch("/api/data/backup", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `chainward-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
      notify({ title: "Workspace backup downloaded", description: "Keep this backup somewhere separate from the Chainward device.", tone: "success" });
    } catch (error) {
      notify({ title: "Backup not created", description: error instanceof Error ? error.message : "Try again.", tone: "danger" });
    } finally { setStorageWorking(null); }
  }

  function chooseRestoreFile(file: File | undefined): void {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json") || file.size > 5_000_000) {
      notify({ title: "Unsupported backup file", description: "Choose a Chainward JSON backup smaller than 5 MB.", tone: "warning" });
      return;
    }
    setRestoreFile(file);
  }

  async function restoreBackup(): Promise<void> {
    if (!restoreFile) return;
    setStorageWorking("restore");
    try {
      const content: unknown = JSON.parse(await restoreFile.text());
      const response = await fetch("/api/data/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(content) });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(isErrorPayload(payload) ? payload.error : "The backup could not be restored.");
      const imported = isRestorePayload(payload) ? payload.imported : 0;
      const skipped = isRestorePayload(payload) ? payload.skipped : 0;
      setRestoreFile(null);
      notify({ title: "Workspace restore complete", description: `${imported} scheme version${imported === 1 ? "" : "s"} imported; ${skipped} existing version${skipped === 1 ? "" : "s"} retained.`, tone: "success" });
      router.refresh();
    } catch (error) {
      notify({ title: "Restore failed", description: error instanceof Error ? error.message : "The file could not be read.", tone: "danger" });
      throw error;
    } finally { setStorageWorking(null); }
  }

  async function testPostgresConnection(): Promise<void> {
    setPostgresWorking(true);
    setPostgresResult(null);
    try {
      const response = await fetch("/api/data/postgres/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...postgres, port: Number(postgres.port) }) });
      const payload: unknown = await response.json();
      if (!response.ok || !isPostgresTestPayload(payload)) throw new Error(isErrorPayload(payload) ? payload.error : "PostgreSQL did not return a valid connection result.");
      setPostgresResult(payload);
      notify({ title: "PostgreSQL connection verified", description: `${payload.database} responded in ${payload.latencyMs} ms.`, tone: "success" });
    } catch (error) {
      notify({ title: "PostgreSQL connection failed", description: error instanceof Error ? error.message : "Check the host, credentials, and network access.", tone: "danger" });
    } finally { setPostgresWorking(false); }
  }

  async function copyDatabaseUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(postgresUrl(postgres));
      notify({ title: "DATABASE_URL copied", description: "Add it to .env.local, then restart Chainward.", tone: "success" });
    } catch {
      notify({ title: "DATABASE_URL not copied", description: "Clipboard access is unavailable in this browser context.", tone: "warning" });
    }
  }

  async function enableMemberNotifications(): Promise<void> {
    if (!canMonitorMembers) {
      notify({ title: "Member monitoring is read-only", description: "An Administrator or platform owner must enable activity monitoring.", tone: "warning" });
      return;
    }
    setNotificationWorking(true);
    try {
      const permission = await requestBrowserNotificationPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") {
        saveMemberNotificationPreferences({ enabled: false });
        notify({
          title: permission === "denied" ? "Notifications are blocked" : "Notifications are unavailable",
          description: permission === "denied" ? "Allow notifications for this site in your browser or Windows site settings, then try again." : "Use HTTPS (or localhost) in a browser that supports desktop notifications.",
          tone: "warning",
        });
        return;
      }
      saveMemberNotificationPreferences({ enabled: true });
      const shown = await showWindowsNotification("Chainward member monitoring is ready", {
        body: "Critical inactivity, watch-list, and expired-holiday signals can now reach Windows while Chainward is open.",
        icon: "/icon.svg",
        badge: "/icon.svg",
        tag: "chainward-notification-test",
        data: { url: "/members" },
      });
      notify({
        title: shown ? "Windows notifications enabled" : "Monitoring enabled, but the test was not shown",
        description: shown ? "Member monitoring is active with the alert rules below." : "Permission was granted, but Windows did not display the confirmation. Use Send test to try again.",
        tone: shown ? "success" : "warning",
      });
    } catch (error) {
      saveMemberNotificationPreferences({ enabled: false });
      setNotificationPermission(getBrowserNotificationPermission());
      notify({
        title: "Notifications could not be enabled",
        description: error instanceof Error ? error.message : "The browser notification request did not complete.",
        tone: "danger",
      });
    } finally {
      setNotificationWorking(false);
    }
  }

  async function testMemberNotification(): Promise<void> {
    setNotificationWorking(true);
    try {
      const shown = await showWindowsNotification("Chainward notification test", {
        body: "Your browser and Windows notification path are working.",
        icon: "/icon.svg",
        badge: "/icon.svg",
        tag: "chainward-notification-test",
        data: { url: "/settings" },
      });
      notify({ title: shown ? "Test notification sent" : "Test notification was not sent", description: shown ? "Check the Windows notification area if it did not appear immediately." : "Confirm this site still has notification permission.", tone: shown ? "success" : "warning" });
    } catch (error) {
      notify({
        title: "Test notification failed",
        description: error instanceof Error ? error.message : "The browser could not send the notification.",
        tone: "danger",
      });
    } finally {
      setNotificationPermission(getBrowserNotificationPermission());
      setNotificationWorking(false);
    }
  }

  function disableMemberNotifications(): void {
    saveMemberNotificationPreferences({ enabled: false });
    notify({ title: "Member notifications paused", description: "Chainward will not poll the member monitor or send Windows alerts in this browser.", tone: "info" });
  }

  // The page header and the "Workspace settings 1 of 6" panel title were both
  // restating the navigation immediately beneath them, so the console now opens
  // straight into the sections and fills the view.
  return <div className="settings-console">
    <div className="professional-settings-layout">
      <aside className="professional-settings-nav">
        <nav aria-label="Settings sections">{views.map((view, index) => { const Icon = view.icon; return <button key={view.id} className={activeView === view.id ? "professional-settings-nav__active" : undefined} onClick={() => selectView(view.id)} aria-current={activeView === view.id ? "page" : undefined}><span><Icon size={17} /></span><p><strong>{view.label}</strong><small>{view.description}</small></p><em>{index + 1}</em></button>; })}</nav>
        <footer><ShieldCheck size={15} /><span><strong>Safe settings</strong><small>Every action describes exactly what it changes.</small></span></footer>
      </aside>

      <main className="professional-settings-view">
        <header className="professional-settings-view__header">
          <span><ActiveIcon size={20} /></span>
          <div><h2>{active.label}</h2><p>{active.description}</p></div>
          <em className="settings-view-step">{activeIndex + 1} <i>/</i> {views.length}</em>
        </header>
        <div className="professional-settings-view__scroll">

        {activeView === "connection" && <section className="settings-view-content">
          <div className="settings-status-hero"><span><KeyRound size={22} /></span><div><p className="eyebrow">Verified identity boundary</p><h3>{telemetry.source === "live" ? "Torn API connected" : "Connection required"}</h3><p>No credential value or guessed permission level is exposed here.</p></div><em className={`connection-pill connection-pill--${telemetry.source}`}><i />{telemetry.source === "live" ? "Verified" : "Not connected"}</em></div>
          <dl className="settings-detail-list"><div><dt>Faction</dt><dd>{telemetry.faction?.name ?? "Unavailable"}</dd></div><div><dt>Faction ID</dt><dd>{telemetry.faction?.id ?? "—"}</dd></div><div><dt>Last server check</dt><dd>{new Date(telemetry.checkedAt).toLocaleString("en-GB")}</dd></div><div><dt>Operational status</dt><dd>{telemetry.message}</dd></div></dl>
          <div className="settings-assurance-grid" aria-label="Connection safeguards">
            <article><span><ShieldCheck size={17} /></span><div><strong>Server-verified identity</strong><p>Faction and player identity come from a server-side Torn check, never a browser claim.</p></div></article>
            <article><span><RefreshCw size={17} /></span><div><strong>Deliberate freshness</strong><p>Active-chain checks and manual sync request an uncached chain snapshot.</p></div></article>
            <article><span><LockKeyhole size={17} /></span><div><strong>Credential isolation</strong><p>The API key is never displayed, returned in telemetry, or included in portable backups.</p></div></article>
          </div>
          <div className="settings-view-actions"><Link className="button button--secondary" href="/connect"><KeyRound size={15} /> {telemetry.source === "live" ? "Replace connection" : "Connect Torn API"}</Link></div>
        </section>}

        {activeView === "operations" && <section className="settings-view-content">
          <div className="settings-status-hero"><span><RefreshCw size={22} /></span><div><p className="eyebrow">Live Torn telemetry</p><h3>{preferences.autoRefresh ? `General refresh every ${preferences.refreshIntervalSeconds} seconds` : "Automatic refresh paused"}</h3><p>{preferences.autoRefresh ? "Active chains tighten to an uncached check every 5 seconds while this tab is visible and online." : "Use manual sync whenever a fresh chain snapshot is needed."}</p></div><em className={`database-health database-health--${preferences.autoRefresh ? "ready" : "attention"}`}><i />{preferences.autoRefresh ? "Live" : "Manual"}</em></div>
          <div className="preference-list"><PreferenceToggle icon={RefreshCw} title="Automatic live refresh" description="Keep faction and active-chain telemetry current while this tab is in use." checked={preferences.autoRefresh} onChange={(value) => saveAppearancePreferences({ autoRefresh: value })} /></div>
          <div className="settings-option-grid"><label><span><Clock3 size={15} /> Refresh interval</span><small>Controls visible-tab background checks. Manual refresh always requests a fresh snapshot.</small><select value={preferences.refreshIntervalSeconds} disabled={!preferences.autoRefresh} onChange={(event) => saveAppearancePreferences({ refreshIntervalSeconds: Number(event.target.value) as 30 | 60 | 120 })}><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option></select></label><label><span><AlertTriangle size={15} /> Chain timeout warning</span><small>Show a workspace warning when the active chain falls below this remaining time.</small><select value={preferences.chainWarningSeconds} onChange={(event) => saveAppearancePreferences({ chainWarningSeconds: Number(event.target.value) as 60 | 120 | 180 | 300 })}><option value="60">1 minute</option><option value="120">2 minutes</option><option value="180">3 minutes</option><option value="300">5 minutes</option></select></label></div>
          <div className="settings-explanation"><span><ShieldCheck size={20} /></span><div><strong>API-conscious polling</strong><p>Checks stop in hidden tabs, retain the last verified snapshot during network failures, and bypass Torn&apos;s service cache only for active chains or a manual sync.</p></div></div>
        </section>}

        {activeView === "notifications" && <section className="settings-view-content">
          <div className="settings-status-hero"><span>{canMonitorMembers && notificationPreferences.enabled && notificationPermission === "granted" ? <BellRing size={22} /> : <BellOff size={22} />}</span><div><p className="eyebrow">Smart member monitor</p><h3>{canMonitorMembers ? notificationStatusTitle(notificationPermission, notificationPreferences.enabled) : "Member-management permission required"}</h3><p>{canMonitorMembers ? notificationStatusDetail(notificationPermission, notificationPreferences.enabled) : "You can review these options, but only an Administrator or platform owner can run the member monitor."}</p></div><em className={`database-health database-health--${canMonitorMembers && notificationPreferences.enabled && notificationPermission === "granted" ? "ready" : "attention"}`}><i />{!canMonitorMembers ? "Read only" : notificationPreferences.enabled && notificationPermission === "granted" ? "Monitoring" : notificationPermission === "denied" ? "Blocked" : "Paused"}</em></div>
          <div className="notification-permission-actions">
            {(!notificationPreferences.enabled || notificationPermission !== "granted") && <button className="button button--primary" disabled={!canMonitorMembers || notificationWorking || notificationPermission === "denied"} onClick={() => void enableMemberNotifications()}>{notificationWorking ? <Spinner size={15} label="Enabling notifications" /> : <BellRing size={15} />} Enable Windows notifications</button>}
            {notificationPreferences.enabled && notificationPermission === "granted" && <><button className="button button--secondary" disabled={notificationWorking} onClick={() => void testMemberNotification()}>{notificationWorking ? <Spinner size={15} label="Sending test notification" tone="muted" /> : <BellRing size={15} />} Send test</button><button className="button button--quiet" onClick={disableMemberNotifications}><BellOff size={15} /> Pause monitoring</button></>}
          </div>
          {!canMonitorMembers && <div className="settings-alert"><ShieldCheck size={17} /><div><strong>Server-enforced activity access</strong><p>The monitor endpoint rechecks the active licence, faction assignment, current roster membership, and members:manage permission on every request.</p></div></div>}
          {notificationPermission === "denied" && <div className="settings-alert settings-alert--warning"><AlertTriangle size={17} /><div><strong>Browser permission is blocked</strong><p>Open this site&apos;s permissions in your browser, change Notifications to Allow, then reload Settings. Chainward cannot override a denied browser permission.</p></div></div>}
          <div className="settings-option-grid settings-option-grid--notifications">
            <label><span><AlertTriangle size={15} /> Minimum alert level</span><small>Choose whether Windows receives the full review queue or critical escalations only.</small><select value={notificationPreferences.minimumLevel} onChange={(event) => saveMemberNotificationPreferences({ minimumLevel: event.target.value === "critical" ? "critical" : "attention" })}><option value="attention">Review and critical</option><option value="critical">Critical only</option></select></label>
            <label><span><RefreshCw size={15} /> Monitor interval</span><small>Checks the roster while Chainward remains open, including a background tab.</small><select value={notificationPreferences.intervalMinutes} onChange={(event) => saveMemberNotificationPreferences({ intervalMinutes: Number(event.target.value) as MemberNotificationIntervalMinutes })}><option value="5">Every 5 minutes</option><option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option><option value="60">Every hour</option></select></label>
            <label><span><Clock3 size={15} /> Unresolved reminder</span><small>Repeat an unchanged alert after this period, without stacking duplicate notifications.</small><select value={notificationPreferences.reminderHours} onChange={(event) => saveMemberNotificationPreferences({ reminderHours: Number(event.target.value) as MemberNotificationReminderHours })}><option value="0">Never repeat</option><option value="4">Every 4 hours</option><option value="12">Every 12 hours</option><option value="24">Every 24 hours</option></select></label>
          </div>
          <div className="preference-list"><PreferenceToggle icon={Eye} title="Include watch-list signals" description="Notify when a deliberately watched member is in the attention queue." checked={notificationPreferences.includeWatchList} onChange={(value) => saveMemberNotificationPreferences({ includeWatchList: value })} /><PreferenceToggle icon={AlertTriangle} title="Include expired holidays" description="Notify when a holiday exemption has ended and needs owner review." checked={notificationPreferences.includeExpiredHolidays} onChange={(value) => saveMemberNotificationPreferences({ includeExpiredHolidays: value })} /><PreferenceToggle icon={BellRing} title="Keep critical alerts visible" description="Ask supported Windows browsers to keep critical notifications on screen until dismissed." checked={notificationPreferences.keepCriticalVisible} onChange={(value) => saveMemberNotificationPreferences({ keepCriticalVisible: value })} /><PreferenceToggle icon={Clock3} title="Quiet hours" description="Hold new Windows alerts during the local-time window below; the next check can deliver them." checked={notificationPreferences.quietHoursEnabled} onChange={(value) => saveMemberNotificationPreferences({ quietHoursEnabled: value })} /></div>
          <div className="quiet-hours-grid"><label><span>Quiet from</span><input type="time" value={notificationPreferences.quietStart} disabled={!notificationPreferences.quietHoursEnabled} onChange={(event) => saveMemberNotificationPreferences({ quietStart: event.target.value })} /></label><label><span>Resume at</span><input type="time" value={notificationPreferences.quietEnd} disabled={!notificationPreferences.quietHoursEnabled} onChange={(event) => saveMemberNotificationPreferences({ quietEnd: event.target.value })} /></label></div>
          <div className="settings-explanation"><span><ShieldCheck size={20} /></span><div><strong>Permission-first and deduplicated</strong><p>Chainward asks only after you press Enable, sends no member data to a third-party notification service, and replaces duplicate alerts. HTTPS is required after deployment. Monitoring continues in a background tab, but the browser must remain running with Chainward open.</p></div></div>
        </section>}

        {activeView === "appearance" && <section className="settings-view-content">
          <div className="settings-explanation"><span><Palette size={20} /></span><div><strong>Readable by default</strong><p>Inter remains the application typeface across interface labels and fine print. These choices are saved in this browser.</p></div></div>
          <div className="appearance-section"><h3>Accent colour</h3><p>Choose a highlight that remains legible against Chainward’s dark surfaces.</p><div className="accent-picker" aria-label="Interface accent">{accentOptions.map((color) => <button key={color} type="button" style={{ "--swatch": color } as React.CSSProperties} className={preferences.accent === color ? "accent-picker__active" : undefined} onClick={() => chooseAccent(color)} aria-label={`Use ${color} accent`}>{preferences.accent === color && <Check size={14} />}</button>)}</div></div>
          <div className="preference-list"><PreferenceToggle icon={SlidersHorizontal} title="Compact density" description="Fit more operational rows on screen." checked={preferences.compact} onChange={(value) => toggleClass("compact", value)} /><PreferenceToggle icon={ShieldCheck} title="High contrast data" description="Increase table and numeric contrast." checked={preferences.highContrast} onChange={(value) => toggleClass("highContrast", value)} /><PreferenceToggle icon={Palette} title="Reduced visual effects" description="Use calmer transitions and charts." checked={preferences.reducedEffects} onChange={(value) => toggleClass("reducedEffects", value)} /></div>
        </section>}

        {activeView === "storage" && <section className="settings-view-content">
          <div className="settings-status-hero"><span><HardDrive size={22} /></span><div><p className="eyebrow">Active storage backend</p><h3>{database.available ? database.label : "Create local storage"}</h3><p>{database.message}</p></div><em className={`database-health database-health--${database.available ? "ready" : "attention"}`}><i />{database.available ? "Ready" : "Not configured"}</em></div>
          {!database.available && database.provider === "none" && <div className="create-database-card"><span><DatabaseBackup size={23} /></span><div><h3>Create a local database file</h3><p>Creates <strong>chainward-local.sqlite</strong> in Chainward’s private data folder. No Docker installation or external server is required.</p><ul><li><Check size={13} /> Reward schemes and versions</li><li><Check size={13} /> Paid-chain acknowledgements</li><li><Check size={13} /> Workspace settings</li></ul></div><button className="button button--primary" disabled={Boolean(storageWorking) || telemetry.source !== "live"} onClick={() => void createDatabaseFile()}>{storageWorking === "create" ? <Spinner size={16} label="Creating local database" /> : <Database size={16} />} {storageWorking === "create" ? "Creating database…" : "Create local database"}</button></div>}
          <div className="backup-action-grid"><article><span><Download size={18} /></span><div><h3>Download portable backup</h3><p>Exports faction settings and reward-scheme versions as JSON. API keys and Torn responses are excluded.</p></div><button className="button button--secondary" disabled={!database.available || telemetry.source !== "live" || Boolean(storageWorking)} onClick={() => void downloadBackup()}>{storageWorking === "download" ? <Spinner size={15} label="Creating portable backup" tone="muted" /> : <Download size={15} />} {storageWorking === "download" ? "Preparing backup…" : "Download backup"}</button></article><article><span><Upload size={18} /></span><div><h3>Restore portable backup</h3><p>Imports missing versions without overwriting historical payout records.</p></div><input ref={restoreInput} type="file" hidden accept="application/json,.json" onChange={(event) => chooseRestoreFile(event.target.files?.[0])} /><button className="button button--secondary" disabled={!database.available || telemetry.source !== "live" || Boolean(storageWorking)} onClick={() => restoreInput.current?.click()}><Upload size={15} /> Choose backup</button></article></div>
          <div className="backup-fine-print"><ShieldCheck size={14} /><p><strong>Storage stays explicit.</strong><span>{database.provider === "sqlite" ? `The active file is ${database.filename}. Move downloaded backups away from this device for real recovery protection.` : "PostgreSQL remains available for shared or hosted installations."}</span></p></div>
        </section>}

        {activeView === "postgresql" && <section className="settings-view-content">
          <div className="settings-status-hero"><span><ServerCog size={22} /></span><div><p className="eyebrow">Shared storage backend</p><h3>{database.provider === "postgresql" && database.available ? database.label : "Configure PostgreSQL"}</h3><p>{database.provider === "postgresql" ? database.message : "Test a database securely, then copy its runtime environment value."}</p></div><em className={`database-health database-health--${database.provider === "postgresql" && database.available ? "ready" : "attention"}`}><i />{database.provider === "postgresql" && database.available ? "Active" : "Setup"}</em></div>
          <div className="postgres-setup-layout">
            <div className="postgres-form-panel">
              <div className="settings-section-heading"><div><h3>Connection details</h3><p>Values remain in memory for this tab and are not written to browser storage.</p></div><Database size={17} /></div>
              <div className="postgres-field-grid"><label className="postgres-field postgres-field--wide"><span>Host</span><input value={postgres.host} autoComplete="off" onChange={(event) => updatePostgres("host", event.target.value)} placeholder="localhost" /></label><label className="postgres-field"><span>Port</span><input value={postgres.port} inputMode="numeric" autoComplete="off" onChange={(event) => updatePostgres("port", event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="5432" /></label><label className="postgres-field postgres-field--wide"><span>Database</span><input value={postgres.database} autoComplete="off" onChange={(event) => updatePostgres("database", event.target.value)} placeholder="chainward" /></label><label className="postgres-field"><span>Username</span><input value={postgres.user} autoComplete="username" onChange={(event) => updatePostgres("user", event.target.value)} placeholder="chainward" /></label><label className="postgres-field postgres-field--password"><span>Password</span><span><input type={showPostgresPassword ? "text" : "password"} value={postgres.password} autoComplete="new-password" onChange={(event) => updatePostgres("password", event.target.value)} /><button type="button" className="icon-button" onClick={() => setShowPostgresPassword((current) => !current)} aria-label={showPostgresPassword ? "Hide PostgreSQL password" : "Show PostgreSQL password"}>{showPostgresPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label></div>
              <label className="postgres-ssl-control"><input type="checkbox" checked={postgres.ssl} onChange={(event) => updatePostgres("ssl", event.target.checked)} /><i aria-hidden="true" /><span><strong>Require SSL</strong><small>Enable for hosted PostgreSQL providers that require encrypted transport.</small></span></label>
              <div className="postgres-url-preview"><span><Clipboard size={14} /> DATABASE_URL</span><code>{redactedPostgresUrl(postgres)}</code></div>
              {postgresResult && <div className="postgres-test-result"><Check size={16} /><span><strong>Connection verified</strong><small>PostgreSQL {postgresResult.serverVersion} · {postgresResult.database} · {postgresResult.latencyMs} ms</small></span></div>}
              <div className="postgres-form-actions"><button className="button button--secondary" disabled={postgresWorking} onClick={() => void testPostgresConnection()}>{postgresWorking ? <Spinner size={15} label="Testing PostgreSQL connection" tone="muted" /> : <Play size={15} />} Test connection</button><button className="button button--primary" disabled={!postgres.host || !postgres.port || !postgres.database || !postgres.user} onClick={() => void copyDatabaseUrl()}><Copy size={15} /> Copy DATABASE_URL</button></div>
            </div>
            <div className="postgres-steps-panel"><div className="settings-section-heading"><div><h3>Activate the database</h3><p>Local Docker and hosted PostgreSQL use the same Prisma schema.</p></div><span>3 steps</span></div><ol><li><span>1</span><div><strong>Start PostgreSQL</strong><p>For the included local container, run:</p><code>npm run db:local</code></div></li><li><span>2</span><div><strong>Set the environment</strong><p>Add the copied value to <code>.env.local</code> as <code>DATABASE_URL</code>.</p></div></li><li><span>3</span><div><strong>Create the schema</strong><p>Apply the current Chainward data model, then restart the app.</p><code>npm run db:push</code></div></li></ol><div className="postgres-setup-note"><ShieldCheck size={15} /><p><strong>Runtime boundary</strong><span>Chainward deliberately cannot rewrite server environment files from a browser request.</span></p></div></div>
          </div>
        </section>}

        {activeView === "developer" && licenceTesting && <section className="settings-view-content">
          <div className={`licence-test-hero licence-test-hero--${licenceTesting.locked ? "locked" : "active"}`}>
            <span>{licenceTesting.locked ? <Lock size={22} /> : <Unlock size={22} />}</span>
            <div>
              <p className="eyebrow">Current licence state</p>
              <h3>{licenceTesting.locked ? "Workspace locked" : licenceTesting.label}</h3>
              <p>{licenceTesting.locked
                ? "Every licensed screen should redirect to the unlock workspace, and shell telemetry should be redacted to faction identity only."
                : `${licenceTesting.factionName ?? "This faction"} has active access, so the full workspace is available.`}</p>
            </div>
          </div>

          <div className="licence-test-actions">
            <button className="button button--secondary" disabled={licenceWorking || licenceTesting.locked} onClick={() => void changeLicenceState("lock")}>
              {licenceWorking ? <Spinner size={15} label="Updating licence state" tone="muted" /> : <Lock size={15} />} Remove licence and lock
            </button>
            <button className="button button--primary" disabled={licenceWorking || !licenceTesting.locked} onClick={() => void changeLicenceState("unlock")}>
              {licenceWorking ? <Spinner size={15} label="Updating licence state" /> : <Unlock size={15} />} Restore lifetime access
            </button>
          </div>

          <div className="licence-test-guards">
            <h4>Why this cannot ship to a paying workspace</h4>
            <ul>
              <li><Check size={13} />Refused in any production build, regardless of who is signed in.</li>
              <li><Check size={13} />Requires local test mode, which only the offline dev script sets.</li>
              <li><Check size={13} />Restricted to the verified platform owner identity.</li>
              <li><Check size={13} />Refuses to run when PostgreSQL is configured, so shared data is never touched.</li>
            </ul>
            <p>Each check is repeated on the server when the action runs, not just here in the interface.</p>
          </div>

          <div className="licence-test-checklist">
            <h4>What to review while locked</h4>
            <ol>
              <li><strong>Gated routes</strong><span>Overview, live chain, members, chain history, analytics, rewards, payouts, and faction access all redirect to the unlock workspace.</span></li>
              <li><strong>Shell redaction</strong><span>The rail badge, chain state, and telemetry banner keep faction identity only — no chain counts.</span></li>
              <li><strong>Telemetry API</strong><span>A direct request to the live-chain endpoint answers 403 rather than returning operational values.</span></li>
              <li><strong>Mutations</strong><span>Reward and payout actions refuse with a licence error before touching storage.</span></li>
            </ol>
          </div>
        </section>}

        {activeView === "privacy" && <section className="settings-view-content">
          <div className="settings-explanation"><span><LockKeyhole size={20} /></span><div><strong>Data minimization</strong><p>Chainward separates Torn-sourced operational data from locally created reward and payment records.</p></div></div>
          <div className="privacy-control-grid"><article><span><KeyRound size={18} /></span><h3>Torn API key</h3><strong>Encrypted server-side</strong><p>Remembered credentials are encrypted at rest. This browser holds only a random HTTP-only session token, and credentials are never included in backups.</p></article><article><span><Database size={18} /></span><h3>Local records</h3><strong>Created by deliberate actions</strong><p>Reward schemes and PAID acknowledgements are stored only after an explicit save or confirmation.</p></article><article><span><Download size={18} /></span><h3>Portable backups</h3><strong>No credentials included</strong><p>Configuration exports exclude API keys, cached Torn responses, and private licence review information.</p></article></div>
        </section>}

        </div>
        <footer className="settings-cycle"><button className="button button--quiet" disabled={activeIndex === 0} onClick={() => cycle(-1)}><ChevronLeft size={15} /> Previous</button><div><span>{activeIndex + 1} / {views.length}</span><strong>{active.label}</strong></div><button className="button button--secondary" disabled={activeIndex === views.length - 1} onClick={() => cycle(1)}>Next section <ChevronRight size={15} /></button></footer>
      </main>
    </div>
    <Dialog open={Boolean(restoreFile)} className="dialog--restore" title="Restore workspace configuration?" description={restoreFile ? `Selected file: ${restoreFile.name}` : undefined} confirmLabel="Restore backup" cancelLabel="Cancel" destructive onConfirm={restoreBackup} onClose={() => setRestoreFile(null)}><div className="restore-warning"><AlertTriangle size={18} /><div><strong>Review before restoring</strong><p>The backup must belong to the connected faction. Missing scheme versions are imported; existing versions and paid-chain history remain untouched.</p></div></div></Dialog>
  </div>;
}

function PreferenceToggle({ icon: Icon, title, description, checked, onChange }: { icon: typeof Palette; title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-preference"><span><Icon size={16} /></span><p><strong>{title}</strong><small>{description}</small></p><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function notificationStatusTitle(permission: BrowserNotificationPermission, enabled: boolean): string {
  if (permission === "unsupported") return "Secure browser notifications required";
  if (permission === "denied") return "Notifications blocked by the browser";
  if (permission === "granted" && enabled) return "Windows member alerts are active";
  if (permission === "granted") return "Notification permission is ready";
  return "Enable permission when you are ready";
}

function notificationStatusDetail(permission: BrowserNotificationPermission, enabled: boolean): string {
  if (permission === "unsupported") return "Open Chainward on HTTPS or localhost in a browser with desktop notification support.";
  if (permission === "denied") return "The browser will not show the permission prompt again until its site setting is changed.";
  if (permission === "granted" && enabled) return "Chainward checks for meaningful member-state changes and sends deduplicated native alerts.";
  if (permission === "granted") return "Permission is granted, but member monitoring is paused in this browser.";
  return "Chainward will ask this browser to allow native notifications after a deliberate click.";
}

async function responseError(response: Response): Promise<string> { const payload: unknown = await response.json().catch(() => null); return isErrorPayload(payload) ? payload.error : "The server could not create a backup."; }
function isErrorPayload(value: unknown): value is { error: string } { return Boolean(value && typeof value === "object" && "error" in value && typeof value.error === "string"); }
function isRestorePayload(value: unknown): value is { imported: number; skipped: number } { return Boolean(value && typeof value === "object" && "imported" in value && typeof value.imported === "number" && "skipped" in value && typeof value.skipped === "number"); }
function isDatabasePayload(value: unknown): value is { filename: string } { return Boolean(value && typeof value === "object" && "filename" in value && typeof value.filename === "string"); }
function isPostgresTestPayload(value: unknown): value is PostgresTestResult { return Boolean(value && typeof value === "object" && "database" in value && typeof value.database === "string" && "user" in value && typeof value.user === "string" && "serverVersion" in value && typeof value.serverVersion === "string" && "latencyMs" in value && typeof value.latencyMs === "number"); }
function postgresUrl(value: PostgresForm): string { return `postgresql://${encodeURIComponent(value.user)}:${encodeURIComponent(value.password)}@${value.host}:${value.port}/${encodeURIComponent(value.database)}?schema=public${value.ssl ? "&sslmode=require" : ""}`; }
function redactedPostgresUrl(value: PostgresForm): string { return `postgresql://${encodeURIComponent(value.user)}:********@${value.host}:${value.port}/${encodeURIComponent(value.database)}?schema=public${value.ssl ? "&sslmode=require" : ""}`; }
