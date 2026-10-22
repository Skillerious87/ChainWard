import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connection: vi.fn(), actor: vi.fn(), displayActor: vi.fn(), telemetry: vi.fn(), access: vi.fn(), assignment: vi.fn(), roster: vi.fn(), database: vi.fn() }));
vi.mock("@/lib/torn/server-client", () => ({ getConfiguredTornConnection: mocks.connection }));
vi.mock("@/lib/auth/current-actor", () => ({ getCurrentActor: mocks.actor, getCurrentActorWithProfileImage: mocks.displayActor }));
vi.mock("@/lib/torn/telemetry-service", () => ({ getWorkspaceTelemetry: mocks.telemetry }));
vi.mock("@/lib/licensing/faction-access", () => ({ getFactionAccessSummary: mocks.access }));
vi.mock("@/lib/auth/faction-access-store", () => ({ getFactionAccessAssignment: mocks.assignment, getFactionAccessWorkspace: vi.fn() }));
vi.mock("@/lib/torn/workspace-data-service", () => ({ getFactionRoster: mocks.roster }));
vi.mock("@/lib/data/database-status", () => ({ getDatabaseStatus: mocks.database }));
vi.mock("@/components/shell/app-shell", () => ({ AppShell: () => null }));
vi.mock("@/lib/members/member-activity-store", () => ({ getMemberActivityMonitorWorkspace: vi.fn(), synchronizeMemberInactivityPeriods: vi.fn() }));

import PlatformLayout from "./layout";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connection.mockResolvedValue({ tornUserId: 42, factionId: 51393 });
  mocks.actor.mockResolvedValue({ tornUserId: 42, name: "Test member", isPlatformAdmin: false, profileImageUrl: "https://profileimages.torn.com/old.gif" });
  mocks.telemetry.mockResolvedValue({ source: "live", mode: "torn", faction: { id: 51393, name: "Test faction" }, chain: null });
  mocks.access.mockResolvedValue({ state: "active" });
  mocks.assignment.mockResolvedValue({ role: "VIEWER" });
  mocks.roster.mockResolvedValue({ available: true, data: [{ tornId: 42 }] });
  mocks.database.mockResolvedValue({ available: true });
});

describe("workspace shell latency", () => {
  it("renders an authorized workspace while its avatar request is still unresolved", async () => {
    let finishAvatar!: (actor: { profileImageUrl: string | null }) => void;
    mocks.displayActor.mockReturnValue(new Promise((resolve) => { finishAvatar = resolve; }));
    const layout = PlatformLayout({ children: <p>Workspace ready</p> });
    const component = layout.props.children as ReactElement<{ children: ReactNode }, (props: { children: ReactNode }) => Promise<ReactElement<{ currentUser: unknown; workspaceAuthorized: boolean; profileImage: Promise<string | null> }>>>;
    const shell = await component.type(component.props);
    expect(shell.props.currentUser).toMatchObject({ tornUserId: 42 });
    expect(shell.props.workspaceAuthorized).toBe(true);
    finishAvatar({ profileImageUrl: "https://profileimages.torn.com/new.gif" });
    await expect(shell.props.profileImage).resolves.toBe("https://profileimages.torn.com/new.gif");
  });
});
