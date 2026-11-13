import type { SVGProps } from "react";

/**
 * Monochrome X (formerly Twitter) mark inheriting currentColor for sidebar nav.
 */
export function XSocialIcon({
  className = "h-4 w-4",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Filled brand-colour X badge for headers and Social Campaign cards. */
export function XBrandIcon({
  className = "h-5 w-5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <rect
        width="22"
        height="22"
        x="1"
        y="1"
        rx="5"
        fill="#09090B"
        stroke="#27272A"
        strokeWidth="1"
      />
      <path
        d="M15.96 6.25h2.15l-4.7 5.37 5.53 7.3h-4.33l-3.39-4.43-3.88 4.43H5.19l5.03-5.74-5.3-7.03h4.44l3.07 4.05 3.53-4.05zm-.75 11.4h1.19L8.7 7.36H7.42l7.79 10.29z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

