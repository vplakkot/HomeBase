import type { ReactNode } from "react";

// Line icons from the mockups (docs/design/mockups/). Each is drawn in
// currentColor, so it takes the colour of the text around it, and is
// hidden from screen readers: whatever it sits beside says what it means.

function Icon({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

export function HomeIcon({ size = 22 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1z" />
    </Icon>
  );
}

export function SectionsIcon({ size = 22 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </Icon>
  );
}

export function ModulesIcon({ size = 22 }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </Icon>
  );
}

export function PlusIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function ChevronRightIcon({ size = 18 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M9 18l6-6-6-6" />
    </Icon>
  );
}

export function ChevronLeftIcon({ size = 20 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M15 18l-6-6 6-6" />
    </Icon>
  );
}

export function ChevronDownIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

export function LockIcon({ size = 13 }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </Icon>
  );
}

// A circled "i" for a card's one-line explanation, shown on hover or
// focus rather than taking up a line of its own.
export function InfoIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </Icon>
  );
}

export function PersonIcon({ size = 18 }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </Icon>
  );
}

export function SettingsIcon({ size = 18 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </Icon>
  );
}

export function SignOutIcon({ size = 18 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" />
      <path d="M10 17l-5-5 5-5M5 12h11" />
    </Icon>
  );
}

export function CheckIcon({ size = 18 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M20 6L9 17l-5-5" />
    </Icon>
  );
}

export function AdminConsoleIcon({ size = 18 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
    </Icon>
  );
}

// One per module, by slug. A test checks every module in lib/modules.ts
// has one.
export const MODULE_ICONS: Record<string, (props: IconProps) => ReactNode> = {
  finances: ({ size = 18 }) => (
    <Icon size={size}>
      <path d="M12 1v22" />
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </Icon>
  ),
  calendar: ({ size = 18 }) => (
    <Icon size={size}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </Icon>
  ),
  pets: ({ size = 18 }) => (
    <Icon size={size}>
      <circle cx="6.5" cy="9.5" r="1.8" />
      <circle cx="12" cy="6" r="1.8" />
      <circle cx="17.5" cy="9.5" r="1.8" />
      <path d="M12 12c-3 0-5 3-5 5 0 1.5 1.3 2 2.3 2h5.4c1 0 2.3-.5 2.3-2 0-2-2-5-5-5z" />
    </Icon>
  ),
  wine: ({ size = 18 }) => (
    <Icon size={size}>
      <path d="M8 3h8l-1 7a3 3 0 01-6 0z" />
      <path d="M12 13v7M9 21h6" />
    </Icon>
  ),
  "meal-plans": ({ size = 18 }) => (
    <Icon size={size}>
      <path d="M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10" />
      <path d="M17 3c-2 1-3 4-3 7h3v11" />
    </Icon>
  ),
  health: ({ size = 18 }) => (
    <Icon size={size}>
      <path d="M3 12h4l2-5 4 10 2-5h6" />
    </Icon>
  ),
};
