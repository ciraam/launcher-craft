import { cn } from "@/lib/utils";

interface CraftLogoProps {
  className?: string;
}

/**
 * Crisp geometric Craft.ro emblem matching the anti-aliased 512px PNG & multi-size ICO.
 */
export function CraftLogo({ className }: CraftLogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-6 shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="craft-bg-grad"
          x1="8"
          y1="6"
          x2="58"
          y2="60"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#8E98F8" />
          <stop offset="48%" stopColor="#5E6AD2" />
          <stop offset="100%" stopColor="#38419A" />
        </linearGradient>
        <radialGradient
          id="craft-sheen"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(24 18) rotate(52) scale(34)"
        >
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Rounded squircle container */}
      <rect x="3" y="3" width="58" height="58" rx="15" fill="url(#craft-bg-grad)" />
      <rect x="3" y="3" width="58" height="58" rx="15" fill="url(#craft-sheen)" />
      <rect
        x="3.75"
        y="3.75"
        width="56.5"
        height="56.5"
        rx="14.25"
        stroke="white"
        strokeOpacity="0.24"
        strokeWidth="1.5"
      />

      {/* Precision geometric Craft.ro diamond-C monogram */}
      <path
        d="M39.2 24.8L33.4 19.0C32.6 18.2 31.4 18.2 30.6 19.0L19.0 30.6C18.2 31.4 18.2 32.6 19.0 33.4L30.6 45.0C31.4 45.8 32.6 45.8 33.4 45.0L39.2 39.2"
        stroke="#FFFFFF"
        strokeWidth="4.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Crisp '.ro' precision focal dot */}
      <circle cx="42.5" cy="32" r="3.4" fill="#E6ECFF" />
    </svg>
  );
}
