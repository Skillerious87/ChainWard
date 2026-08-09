"use client";

import {
  Archive,
  CalendarRange,
  Check,
  Copy,
  Download,
  Ellipsis,
  FilePlus2,
  ListFilter,
  Plus,
  RotateCcw,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { downloadCsv, notify, type ToastTone } from "@/lib/client-actions";

type IconName =
  | "archive"
  | "calendar"
  | "check"
  | "copy"
  | "download"
  | "filter"
  | "more"
  | "new"
  | "plus"
  | "recalculate"
  | "settings";

const icons: Record<IconName, LucideIcon> = {
  archive: Archive,
  calendar: CalendarRange,
  check: Check,
  copy: Copy,
  download: Download,
  filter: ListFilter,
  more: Ellipsis,
  new: FilePlus2,
  plus: Plus,
  recalculate: RotateCcw,
  settings: Settings2,
};

interface FeedbackButtonProps {
  label: string;
  message: string;
  description?: string;
  icon?: IconName;
  className?: string;
  tone?: ToastTone;
}

export function FeedbackButton({
  label,
  message,
  description,
  icon,
  className = "button button--secondary",
  tone = "success",
}: FeedbackButtonProps) {
  const Icon = icon ? icons[icon] : null;
  return (
    <button
      className={className}
      onClick={() => notify({ title: message, description, tone })}
    >
      {Icon && <Icon size={15} />}
      {label}
    </button>
  );
}

interface ExportButtonProps {
  filename: string;
  rows: readonly Record<string, string | number>[];
  label?: string;
  className?: string;
}

export function ExportButton({
  filename,
  rows,
  label = "Export CSV",
  className = "button button--secondary",
}: ExportButtonProps) {
  return (
    <button className={className} onClick={() => downloadCsv(filename, rows)}>
      <Download size={15} /> {label}
    </button>
  );
}

export interface MenuOption {
  label: string;
  description?: string;
  value: string;
}

interface MenuButtonProps {
  label: string;
  icon?: IconName;
  options: readonly MenuOption[];
  selected?: string;
  onSelect?: (value: string) => void;
  className?: string;
  align?: "left" | "right";
  reflectSelection?: boolean;
}

export function MenuButton({
  label,
  icon,
  options,
  selected,
  onSelect,
  className = "button button--quiet",
  align = "right",
  reflectSelection = true,
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [internalSelected, setInternalSelected] = useState(selected ?? options[0]?.value);
  const Icon = icon ? icons[icon] : null;
  const currentSelection = onSelect && selected !== undefined ? selected : internalSelected;
  const visibleLabel = reflectSelection
    ? options.find((option) => option.value === currentSelection)?.label ?? label
    : label;
  return (
    <div className="menu-control">
      <button className={className} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {Icon && <Icon size={15} />}{visibleLabel}
      </button>
      {open && (
        <>
          <button className="menu-control__scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className={`menu-popover menu-popover--${align}`} role="menu">
            {options.map((option) => (
              <button
                key={option.value}
                role="menuitemradio"
                aria-checked={currentSelection === option.value}
                onClick={() => {
                  setInternalSelected(option.value);
                  if (onSelect) onSelect(option.value);
                  else notify({ title: `${option.label} selected`, description: option.description, tone: "info" });
                  setOpen(false);
                }}
              >
                <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                {currentSelection === option.value && <Check size={14} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
