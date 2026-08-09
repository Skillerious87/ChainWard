"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  className?: string;
  title: string;
  description?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  confirmLabel: string;
  cancelLabel?: string;
  hideCancel?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  children?: ReactNode;
}

export function Dialog({
  open,
  className,
  title,
  description,
  destructive = false,
  confirmDisabled = false,
  confirmLabel,
  cancelLabel = "Cancel",
  hideCancel = false,
  onConfirm,
  onClose,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog${className ? ` ${className}` : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="dialog__header">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={18} />
        </button>
      </div>
      {children && <div className="dialog__body">{children}</div>}
      <div className="dialog__actions">
        {!hideCancel && <button className="button button--secondary" onClick={onClose}>{cancelLabel}</button>}
        <button
          className={`button ${destructive ? "button--danger" : "button--primary"}`}
          disabled={confirmDisabled || submitting}
          onClick={async () => {
            setSubmitting(true);
            try {
              await onConfirm();
              onClose();
            } catch {
              // The invoking workflow owns user-facing error feedback.
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
