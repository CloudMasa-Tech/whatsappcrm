import { describe, it, expect, vi, beforeEach } from "vitest";
import { processDueReminders } from "./reminders";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("processDueReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when there are no due reminders", async () => {
    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    } as unknown as SupabaseClient;

    const count = await processDueReminders(mockDb);
    expect(count).toBe(0);
  });

  it("processes due reminders, reopens conversations and marks reminders completed", async () => {
    const dueReminder = {
      id: "rem-1",
      account_id: "acc-1",
      project_id: "proj-1",
      conversation_id: "conv-1",
      user_id: "user-1",
      note: "Follow up about quote",
    };

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const mockSelect = vi.fn().mockReturnValue({
      is: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [dueReminder], error: null }),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "conv-1",
          status: "pending",
          contact: { name: "Alice", phone: "+1234567890" },
        },
        error: null,
      }),
    });

    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "notif-1" }, error: null }),
    });

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === "conversation_reminders") {
          return {
            select: mockSelect,
            update: mockUpdate,
          };
        }
        if (table === "conversations") {
          return {
            select: mockSelect,
            update: mockUpdate,
          };
        }
        if (table === "notifications") {
          return {
            insert: mockInsert,
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const count = await processDueReminders(mockDb);
    expect(count).toBe(1);
    expect(mockUpdate).toHaveBeenCalled();
  });
});
