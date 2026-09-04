"use client";

import {
  ChevronRight,
  Crown,
  Info,
  KeyRound,
  LogOut,
  MonitorCog,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { PlatformActor } from "@/lib/auth/platform-owner";

interface ProfileMenuProps {
  actor: PlatformActor;
  compact: boolean;
  ownerAccess: boolean;
  onClose: () => void;
  onDisconnect: () => void;
  onOpenAbout: () => void;
  onToggleDensity: () => void;
}

export function ProfileMenu({
  actor,
  compact,
  ownerAccess,
  onClose,
  onDisconnect,
  onOpenAbout,
  onToggleDensity,
}: ProfileMenuProps) {
  const connected = actor.tornUserId > 0;

  return (
    <section className="profile-popover" aria-label="Profile and workspace controls">
      <div className="profile-popover__identity">
        <span className="profile-popover__avatar">
          <UserAvatar className="user-avatar__image" imageUrl={actor.profileImageUrl} name={actor.name} size={44} />
          <i className={connected ? undefined : "profile-popover__status--offline"} aria-hidden="true" />
        </span>
        <span className="profile-popover__identity-copy">
          <span className="profile-popover__name-row">
            <strong>{actor.name}</strong>
            {ownerAccess && <em><Crown size={10} /> Owner</em>}
          </span>
          <small>{connected ? <>Verified Torn identity <b>#{actor.tornUserId}</b></> : "No Torn identity connected"}</small>
        </span>
      </div>

      <div className="profile-popover__group">
        <p>Workspace</p>
        {ownerAccess && (
          <Link className="profile-popover__item" href="/admin" onClick={onClose}>
            <span className="profile-popover__item-icon profile-popover__item-icon--owner"><ShieldCheck size={16} /></span>
            <span><strong>Owner administration</strong><small>Licensing and service controls</small></span>
            <ChevronRight size={14} />
          </Link>
        )}
        <Link className="profile-popover__item" href="/settings" onClick={onClose}>
          <span className="profile-popover__item-icon"><Settings size={16} /></span>
          <span><strong>Workspace settings</strong><small>Connection, alerts and storage</small></span>
          <ChevronRight size={14} />
        </Link>
      </div>

      <div className="profile-popover__group">
        <p>Preferences</p>
        <button className="profile-popover__item" type="button" role="switch" aria-checked={compact} onClick={onToggleDensity}>
          <span className="profile-popover__item-icon"><MonitorCog size={16} /></span>
          <span><strong>Compact density</strong><small>{compact ? "On · show more rows" : "Off · comfortable spacing"}</small></span>
          <i className="profile-popover__switch" aria-hidden="true"><span /></i>
        </button>
        <button className="profile-popover__item" type="button" onClick={onOpenAbout}>
          <span className="profile-popover__item-icon"><Info size={16} /></span>
          <span><strong>About Chainward</strong><small>Version and application details</small></span>
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="profile-popover__footer">
        {connected ? (
          <button className="profile-popover__disconnect" type="button" onClick={onDisconnect}>
            <LogOut size={15} />
            <span><strong>Disconnect Torn API</strong><small>Return to the connection screen</small></span>
          </button>
        ) : (
          <Link className="profile-popover__connect" href="/connect" onClick={onClose}>
            <KeyRound size={15} />
            <span><strong>Connect Torn API</strong><small>Verify a faction workspace</small></span>
            <ChevronRight size={14} />
          </Link>
        )}
      </div>
    </section>
  );
}
