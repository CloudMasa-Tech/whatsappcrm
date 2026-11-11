import type { SVGProps } from "react";

export function LinkedIn({ className = "h-4 w-4", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

export function LinkedInBrandIcon({
  className = "h-5 w-5",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      {...props}
    >
      <rect width="22" height="22" x="1" y="1" rx="5" fill="#0A66C2" />
      <path
        d="M8 10v7H5.5v-7H8zm-1.25-3.9a1.45 1.45 0 1 1 0 2.9 1.45 1.45 0 0 1 0-2.9zM18.5 17H16v-3.6c0-.95-.34-1.6-1.2-1.6-.66 0-1.05.44-1.22.87-.06.15-.08.37-.08.58V17H11s.03-6.4 0-7h2.5v1c.33-.51.92-1.23 2.25-1.23 1.64 0 2.75 1.07 2.75 3.38V17z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

