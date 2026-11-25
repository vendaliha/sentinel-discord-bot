import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const OverviewIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.6" />
    <rect x="14" y="3" width="7" height="5" rx="1.6" />
    <rect x="3" y="16" width="7" height="5" rx="1.6" />
    <rect x="14" y="12" width="7" height="9" rx="1.6" />
  </Icon>
);

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7 3v6c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3z" />
    <path d="M9.2 12.2l2 2 3.6-3.8" />
  </Icon>
);

export const SlidersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0111 0" />
    <path d="M16 5.3a3 3 0 010 5.4M17.5 13.6A5 5 0 0121 18.4" />
  </Icon>
);

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M4.5 4.5l1.7 1.7M17.8 17.8l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.5 19.5l1.7-1.7M17.8 6.2l1.7-1.7" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const BoltIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.5 3L6 13.5h4.5L10 21l7.5-10.5H13L13.5 3z" />
  </Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const BotIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="7.5" width="16" height="12" rx="3" />
    <path d="M12 4v3.5M8.5 13v1.5M15.5 13v1.5M9.5 19.5v1.5M14.5 19.5v1.5" />
  </Icon>
);

export const ArrowUpRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 17L17 7M9 7h8v8" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4.5l8.5 15H3.5l8.5-15z" />
    <path d="M12 9.5v4M12 16.6v.4" />
  </Icon>
);

export const BanIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 18L18 6" />
  </Icon>
);

export const MuteIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 5L6.5 9H3v6h3.5L11 19V5z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Icon>
);

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 13.5a4 4 0 015.7 0l2.3-2.3a4 4 0 00-5.7-5.7L11 6.8" />
    <path d="M14 10.5a4 4 0 00-5.7 0L6 12.8a4 4 0 005.7 5.7l1.3-1.3" />
  </Icon>
);

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12a8 8 0 10-2.6 5.9" />
    <path d="M20 5v6h-6" />
  </Icon>
);

export const InboxIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 13l2.5-7h11L20 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5z" />
    <path d="M4 13h4l1.5 2.5h5L16 13h4" />
  </Icon>
);
