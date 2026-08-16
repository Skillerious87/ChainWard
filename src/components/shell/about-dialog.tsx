"use client";

import Image from "next/image";
import { ExternalLink, ShieldCheck, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import packageInfo from "../../../package.json";
import chainwardLogo from "../../../ChainWardLogo.png";
import { PLATFORM_OWNER } from "@/lib/auth/platform-owner";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export const CHAINWARD_VERSION = packageInfo.version;

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="about-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="about-dialog__surface">
        <button type="button" className="about-dialog__close" autoFocus onClick={onClose} aria-label="Close About Chainward">
          <X size={17} aria-hidden="true" />
        </button>

        <header className="about-dialog__hero">
          <span className="about-dialog__mark" aria-hidden="true">
            <Image src={chainwardLogo} alt="" width={37} height={46} draggable={false} />
          </span>
          <span className="about-dialog__status"><i /> Independent community tool</span>
          <h2 id={titleId}>Chainward</h2>
          <p id={descriptionId}>Faction chain operations, reward calculations, and payout records in one verified workspace.</p>
        </header>

        <dl className="about-dialog__facts" aria-label="Application information">
          <div>
            <dt>Version</dt>
            <dd>{CHAINWARD_VERSION}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>Web app</dd>
          </div>
          <div>
            <dt>Data source</dt>
            <dd>Torn API</dd>
          </div>
        </dl>

        <a
          className="about-dialog__creator"
          href={PLATFORM_OWNER.profileUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`View ${PLATFORM_OWNER.name}'s Torn profile`}
        >
          <span className="about-dialog__avatar" aria-hidden="true">SK</span>
          <span>
            <small>Created and maintained by</small>
            <strong>{PLATFORM_OWNER.name} <em>#{PLATFORM_OWNER.tornUserId}</em></strong>
          </span>
          <ExternalLink size={16} aria-hidden="true" />
        </a>

        <footer className="about-dialog__note">
          <ShieldCheck size={15} aria-hidden="true" />
          <span>Restricted API access. Not affiliated with Torn.</span>
        </footer>
      </section>
    </dialog>
  );
}
