"use client";

import { CircleHelp, ExternalLink, KeyRound, ShieldCheck, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * The sign-in screen dropped its inline "How your key is used" panel for a
 * quieter card; this is where that guidance lives now — a single question-
 * mark trigger, top-right, opening a short native <dialog> on demand instead
 * of sitting permanently on the page.
 */
export function ApiKeyHelpDialog() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button type="button" className="login-help" onClick={() => setOpen(true)} aria-label="How the Torn API key works">
        <CircleHelp size={17} />
      </button>

      <dialog
        ref={ref}
        className="key-help-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <section className="key-help-dialog__surface">
          <button type="button" className="key-help-dialog__close" onClick={() => setOpen(false)} aria-label="Close">
            <X size={16} />
          </button>

          <header className="key-help-dialog__header">
            <span className="key-help-dialog__mark" aria-hidden="true"><KeyRound size={18} /></span>
            <h2 id={titleId}>Your Torn API key</h2>
          </header>

          <div className="key-help-dialog__section">
            <h3>What it&apos;s for</h3>
            <p>
              Chainward uses your key server-side to verify your identity and faction, then reads chain, member,
              and reward data into your workspace. It is never sent to your browser or shown to other members.
            </p>
          </div>

          <div className="key-help-dialog__section">
            <h3>Getting one</h3>
            <ol>
              <li>Open Torn → Settings → API Keys</li>
              <li>Create a key with <strong>Limited Access</strong></li>
              <li>Paste it below — nothing is saved until you connect</li>
            </ol>
          </div>

          <a className="key-help-dialog__cta" href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noreferrer">
            Open Torn API settings <ExternalLink size={13} />
          </a>

          <p className="key-help-dialog__note"><ShieldCheck size={13} /> Encrypted at rest. Read-only access only.</p>
        </section>
      </dialog>
    </>
  );
}
