"use client";

import { ArrowUpRight, ClipboardList, History, LayoutDashboard, RotateCcw, Trophy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

type PayoutRoute = "/payouts" | "/payouts/ledger" | "/payouts/recipients" | "/payouts/corrections";

interface PayoutWorkspaceNavigationProps {
  registerCount: number;
  recipientCount: number;
  correctionCount: number;
}

export function PayoutWorkspaceNavigation({ registerCount, recipientCount, correctionCount }: PayoutWorkspaceNavigationProps) {
  // The app router always supplies a pathname in production. The fallback also
  // leaves the server-rendered overview state deterministic in isolated tests.
  const pathname = usePathname() || "/payouts";
  const sections: ReadonlyArray<{ href: PayoutRoute; label: string; count?: number; icon: ComponentType<{ size?: number }> }> = [
    { href: "/payouts", label: "Overview", icon: LayoutDashboard },
    { href: "/payouts/ledger", label: "Ledger", count: registerCount, icon: ClipboardList },
    { href: "/payouts/recipients", label: "Recipients", count: recipientCount, icon: Trophy },
    { href: "/payouts/corrections", label: "Corrections", count: correctionCount, icon: RotateCcw },
  ];

  return <nav className="payout-workspace-nav" aria-label="Payout ledger views">
    <div className="payout-workspace-nav__sections">
      {sections.map((section) => {
        const active = pathname === section.href;
        const Icon = section.icon;
        return <Link key={section.href} href={section.href} className={active ? "payout-workspace-nav__active" : undefined} aria-current={active ? "page" : undefined}><Icon size={14} /><span>{section.label}</span>{section.count !== undefined && <small>{section.count.toLocaleString()}</small>}</Link>;
      })}
    </div>
    <div className="payout-workspace-nav__routes">
      <Link href="/chains"><History size={14} /> Chain history <ArrowUpRight size={12} /></Link>
      <Link href="/rewards">Reward schemes <ArrowUpRight size={12} /></Link>
    </div>
  </nav>;
}
