import type { SVGProps } from "react";

export function Facebook({ className = "h-4 w-4", ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

export function FacebookBrandIcon({ className = "h-5 w-5", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      {...props}
    >
      <circle cx="12" cy="12" r="11" fill="#1877F2" />
      <path
        d="M13.5 19v-6.5h2.2l.3-2.5h-2.5V8.4c0-.7.2-1.2 1.3-1.2h1.4V5c-.2 0-1.1-.1-2.2-.1-2.2 0-3.6 1.3-3.6 3.8V10H8v2.5h2.4V19h3.1z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function MessengerBrandIcon({ className = "h-5 w-5", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      {...props}
    >
      <defs>
        <linearGradient id="msg-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0078FF" />
          <stop offset="50%" stopColor="#00C6FF" />
          <stop offset="100%" stopColor="#A033FF" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill="url(#msg-grad)" />
      <path
        d="M7 13.5l3.5-3.5 2 2 4.5-4.5-3.5 3.5-2-2-4.5 4.5z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
