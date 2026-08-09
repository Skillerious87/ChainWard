interface MemberAvatarProps {
  name: string;
  size?: "small" | "medium";
}

const accents = ["lime", "cyan", "amber", "violet"] as const;

export function MemberAvatar({ name, size = "medium" }: MemberAvatarProps) {
  const initials = name.slice(0, 2).toUpperCase();
  const total = [...name].reduce((value, character) => value + character.charCodeAt(0), 0);
  const accent = accents[total % accents.length];
  return (
    <span className={`avatar avatar--${size} avatar--${accent}`} aria-hidden="true">
      {initials}
    </span>
  );
}
