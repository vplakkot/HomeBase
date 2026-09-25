import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./button.module.css";

// The one button style on a module home (DESIGN.md §6). A link looks the
// same; a form's submit button takes `buttonClass`.
export const buttonClass = styles.button;

// `label` makes it icon-only; `desktopOnly` hides it on a phone, where
// the same action is pinned above the bottom bar.
export function ButtonLink({
  href,
  children,
  label,
  desktopOnly = false,
}: {
  href: string;
  children: ReactNode;
  label?: string;
  desktopOnly?: boolean;
}) {
  const className = [styles.button, label ? styles.icon : "", desktopOnly ? styles.desktopOnly : ""].filter(Boolean).join(" ");
  return (
    <Link href={href} className={className} aria-label={label}>
      {children}
    </Link>
  );
}
