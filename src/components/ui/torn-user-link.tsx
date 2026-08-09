import type { ReactNode } from "react";
import { MemberAvatar } from "@/components/ui/member-avatar";

interface TornUserLinkProps {
  name: string;
  tornUserId: number;
  className?: string;
  detail?: ReactNode;
  avatar?: boolean;
}

export function TornUserLink({ name, tornUserId, className, detail, avatar = true }: TornUserLinkProps) {
  return <a
    className={`torn-user-link${className ? ` ${className}` : ""}`}
    href={`https://www.torn.com/profiles.php?XID=${tornUserId}`}
    target="_blank"
    rel="noreferrer"
    title={`Torn user ID ${tornUserId}`}
    aria-label={`${name}, Torn user ID ${tornUserId}`}
  >
    {avatar && <MemberAvatar name={name} />}
    <span className="torn-user-link__copy"><strong>{name}</strong>{detail && <small>{detail}</small>}</span>
  </a>;
}

export function TornUserName({ name, tornUserId, detail }: Omit<TornUserLinkProps, "className" | "avatar">) {
  return <span className={`torn-user-name${detail ? " torn-user-name--stacked" : ""}`} title={`Torn user ID ${tornUserId}`} aria-label={`${name}, Torn user ID ${tornUserId}`}><strong>{name}</strong>{detail && <small>{detail}</small>}</span>;
}
