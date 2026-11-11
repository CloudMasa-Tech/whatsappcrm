import { NextRequest, NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  fetchMediaComments,
  replyToComment,
  setCommentHidden,
  deleteInstagramComment,
  sendPrivateCommentReply,
  InstagramMetaError,
} from "@/lib/instagram/meta-client";
import type { InstagramTokenType } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

async function loadCloudConfig(projectId: string) {
  const { data: config } = await supabaseAdmin()
    .from("instagram_config")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "connected")
    .maybeSingle();

  if (!config || config.connection_method !== "cloud_api" || !config.access_token) {
    throw new InstagramMetaError(
      "Instagram Comment Moderation & Private Comment-to-DM requires a connected Meta Cloud API token.",
      400,
    );
  }

  return {
    accessToken: decrypt(config.access_token),
    igId: (config.instagram_business_id as string | null) ?? null,
    pageId: (config.page_id as string | null) ?? null,
    tokenType: (config.token_type as InstagramTokenType | undefined) ?? null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireProjectRole("viewer");
    const mediaId = request.nextUrl.searchParams.get("mediaId")?.trim();
    if (!mediaId) {
      return NextResponse.json({ error: "mediaId query parameter is required" }, { status: 400 });
    }

    const { accessToken, tokenType } = await loadCloudConfig(ctx.projectId);
    const comments = await fetchMediaComments(accessToken, mediaId, tokenType);

    return NextResponse.json({ success: true, comments });
  } catch (err) {
    if (err instanceof InstagramMetaError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireProjectRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.action || !body?.commentId) {
      return NextResponse.json({ error: "action and commentId are required" }, { status: 400 });
    }

    const { action, commentId, text } = body as {
      action: "reply" | "hide" | "unhide" | "delete" | "private_dm";
      commentId: string;
      text?: string;
    };

    const { accessToken, igId, pageId, tokenType } = await loadCloudConfig(ctx.projectId);

    switch (action) {
      case "reply": {
        if (!text?.trim()) {
          return NextResponse.json({ error: "Reply text is required" }, { status: 400 });
        }
        const res = await replyToComment(accessToken, commentId, text.trim(), tokenType);
        return NextResponse.json({ success: true, replyId: res.id });
      }
      case "hide": {
        await setCommentHidden(accessToken, commentId, true, tokenType);
        return NextResponse.json({ success: true, hidden: true });
      }
      case "unhide": {
        await setCommentHidden(accessToken, commentId, false, tokenType);
        return NextResponse.json({ success: true, hidden: false });
      }
      case "delete": {
        await deleteInstagramComment(accessToken, commentId, tokenType);
        return NextResponse.json({ success: true, deleted: true });
      }
      case "private_dm": {
        if (!text?.trim()) {
          return NextResponse.json({ error: "DM text is required" }, { status: 400 });
        }
        const res = await sendPrivateCommentReply(accessToken, commentId, text.trim(), {
          tokenType,
          igId,
          pageId,
        });
        return NextResponse.json({ success: true, messageId: res.messageId });
      }
      default:
        return NextResponse.json({ error: "Unsupported comment action" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof InstagramMetaError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

