import type { SVGProps } from "react";

/**
 * Outline WhatsApp mark, drawn with `currentColor` so it inherits nav
 * state colours exactly like the lucide icons beside it.
 */
export function WhatsApp({ className = "h-4 w-4", ...props }: SVGProps<SVGSVGElement>) {
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
      aria-hidden="true"
      {...props}
    >
      {/* Speech bubble with the tail at the lower-left, as in the mark. */}
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      {/* Handset. */}
      <path d="M9.6 8.5c.2-.1.5 0 .6.2l.8 1.4c.1.2.1.4 0 .6l-.5.7c-.1.2-.1.4 0 .5a6 6 0 0 0 2.6 2.6c.2.1.4.1.5 0l.7-.5c.2-.1.4-.1.6 0l1.4.8c.2.1.3.4.2.6a2 2 0 0 1-2 1.4 7.5 7.5 0 0 1-6.3-6.3 2 2 0 0 1 1.4-2z" />
    </svg>
  );
}

/** Filled brand-colour mark, for headers and channel accents. */
export function WhatsAppBrandIcon({
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
      <circle cx="12" cy="12" r="11" fill="#25D366" />
      <path
        d="M16.7 13.9c-.3-.1-1.6-.8-1.9-.9-.2-.1-.4-.1-.6.1-.2.3-.6.9-.8 1.1-.1.2-.3.2-.5.1a6 6 0 0 1-3-2.6c-.2-.4 0-.5.2-.7l.4-.5c.1-.2.1-.3 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.2s.9 2.5 1.1 2.7c.1.2 1.8 2.8 4.4 3.8 1.6.6 2.2.7 3 .5.5-.1 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3z"
        fill="#FFFFFF"
      />
      <path
        d="M12 5.5a6.5 6.5 0 0 0-5.5 9.9L5.8 18l2.7-.7A6.5 6.5 0 1 0 12 5.5z"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.2"
      />
    </svg>
  );
}
