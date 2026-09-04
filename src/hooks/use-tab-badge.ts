"use client";

import { useEffect, useRef } from "react";
import { useTotalUnread } from "./use-total-unread";
import { useUnreadNotifications } from "./use-unread-notifications";

/**
 * Dynamically prefixes the browser tab title with the number of unread
 * conversations or notifications, e.g. "(3) MaSa CRM - Inbox" or restores it
 * when unreads are cleared.
 */
export function useTabBadge() {
  const unreadConversations = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const originalTitleRef = useRef<string>("");

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (!originalTitleRef.current) {
      // Strip any existing badge if hot reloading or initial mount
      originalTitleRef.current = document.title.replace(/^\(\d+\)\s*/, "") || "MaSa CRM";
    }

    const total = unreadConversations + unreadNotifications;
    const baseTitle = originalTitleRef.current;

    if (total > 0) {
      document.title = `(${total}) ${baseTitle}`;
    } else {
      document.title = baseTitle;
    }
  }, [unreadConversations, unreadNotifications]);
}
