import type { Metadata } from "next";
import { AdminShell } from "./admin-shell";

// Server layout for the admin area. Only super_admins reach here —
// the middleware/proxy already blocks /admin/* for non-super-admins.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminShell>{children}</AdminShell>;
}
