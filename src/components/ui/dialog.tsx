"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";

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
  const titleId = useId();
  const descriptionId = useId();
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
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={submitting || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) onClose();
      }}
      // Calling dialog.close() after the parent has already set `open` false
      // fires a native close event. Only propagate user/native closes while the
      // controlled dialog is still open, otherwise callbacks run twice.
      onClose={() => {
        if (open) onClose();
      }}
    >
      <div className="dialog__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button type="button" className="icon-button" onClick={onClose} disabled={submitting} aria-label="Close dialog">
          <X size={18} />
        </button>
      </div>
      {children && <div className="dialog__body">{children}</div>}
      <div className="dialog__actions">
        {!hideCancel && <button type="button" className="button button--secondary" onClick={onClose} disabled={submitting}>{cancelLabel}</button>}
        <button
          type="button"
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
          {submitting && <Spinner size={15} label="Working" tone={destructive ? "muted" : "accent"} />}
          {submitting ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
