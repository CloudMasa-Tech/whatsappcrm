import { describe, it, expect } from "vitest";

import { resolveChannel, type InboxChannel } from "./conversations";

type ChannelFilter = "all" | InboxChannel;

/** The exact predicate the Inbox list applies to each conversation. */
function passesChannelFilter(
  conversation: Parameters<typeof resolveChannel>[0],
  filter: ChannelFilter,
): boolean {
  if (filter === "all") return true;
  return resolveChannel(conversation) === filter;
}

function convo(
  channel: string | null,
  contactChannel: string | null = null,
): Parameters<typeof resolveChannel>[0] {
  return {
    channel,
    contact: contactChannel === null ? null : { channel: contactChannel },
  } as Parameters<typeof resolveChannel>[0];
}

describe("resolveChannel", () => {
  it("reads the channel off the conversation", () => {
    expect(resolveChannel(convo("whatsapp"))).toBe("whatsapp");
    expect(resolveChannel(convo("instagram"))).toBe("instagram");
    expect(resolveChannel(convo("email"))).toBe("email");
    expect(resolveChannel(convo("facebook"))).toBe("facebook");
  });

  it("falls back to the contact's channel for legacy rows with no conversation channel", () => {
    expect(resolveChannel(convo(null, "instagram"))).toBe("instagram");
    expect(resolveChannel(convo(null, "email"))).toBe("email");
    expect(resolveChannel(convo(null, "facebook"))).toBe("facebook");
  });

  it("treats a fully unset channel as WhatsApp, matching the column default", () => {
    expect(resolveChannel(convo(null))).toBe("whatsapp");
    expect(resolveChannel(convo(null, null))).toBe("whatsapp");
  });

  it("never drops an unrecognised channel — it must stay visible somewhere", () => {
    // A future channel added server-side before the UI knows about it
    // still lands in a bucket rather than disappearing from every filter.
    expect(resolveChannel(convo("telegram"))).toBe("whatsapp");
  });

  it("prefers the contact's channel when the conversation disagrees", () => {
    // Instagram threads were historically identified by the contact.
    expect(resolveChannel(convo("whatsapp", "instagram"))).toBe("instagram");
  });
});

describe("inbox channel filter", () => {
  const all = [
    convo("whatsapp"),
    convo("instagram"),
    convo("email"),
    convo("facebook"),
  ];

  it("'all' shows every channel — WhatsApp, Instagram, Facebook and Email", () => {
    const visible = all.filter((c) => passesChannelFilter(c, "all"));

    expect(visible).toHaveLength(4);
    expect(visible.map((c) => resolveChannel(c)).sort()).toEqual([
      "email",
      "facebook",
      "instagram",
      "whatsapp",
    ]);
  });

  it("'all' also keeps legacy rows that carry no channel at all", () => {
    const withLegacy = [...all, convo(null)];
    expect(withLegacy.filter((c) => passesChannelFilter(c, "all"))).toHaveLength(5);
  });

  it.each<InboxChannel>(["whatsapp", "instagram", "email", "facebook"])(
    "'%s' narrows to exactly that channel",
    (channel) => {
      const visible = all.filter((c) => passesChannelFilter(c, channel));
      expect(visible).toHaveLength(1);
      expect(resolveChannel(visible[0])).toBe(channel);
    },
  );

  it("the per-channel filters partition the list with no gaps or overlap", () => {
    const counts = (["whatsapp", "instagram", "email", "facebook"] as const).map(
      (ch) => all.filter((c) => passesChannelFilter(c, ch)).length,
    );
    // Every conversation is counted exactly once across the channels.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(all.length);
  });
});
