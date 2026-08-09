import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon size={20} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
