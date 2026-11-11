import { NextRequest, NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  fetchInstagramMediaGrid,
  fetchInstagramStories,
  fetchMentionedMedia,
  updateInstagramMedia,
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

  if (!config) {
    throw new InstagramMetaError("Instagram is not connected for this project.", 400);
  }
  if (config.connection_method !== "cloud_api" || !config.access_token) {
    throw new InstagramMetaError(
      "Viewing Feed, Stories, Mentions, and editing posts requires a Meta Cloud API key.",
      400,
    );
  }
  return {
    accessToken: decrypt(config.access_token),
    igId: (config.instagram_business_id as string | null) || "me",
    tokenType: (config.token_type as InstagramTokenType | undefined) ?? null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireProjectRole("viewer");
    const { accessToken, igId, tokenType } = await loadCloudConfig(ctx.projectId);
    const include = request.nextUrl.searchParams.get("include") || "media,stories";
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 24), 50);

    const media = await fetchInstagramMediaGrid(accessToken, igId, tokenType, limit);

    let stories: Awaited<ReturnType<typeof fetchInstagramStories>> = [];
    if (include.includes("stories")) {
      stories = await fetchInstagramStories(accessToken, igId, tokenType).catch(() => []);
    }

    let mentions: Awaited<ReturnType<typeof fetchMentionedMedia>> = [];
    if (include.includes("mentions")) {
      mentions = await fetchMentionedMedia(accessToken, igId, tokenType, 12).catch(() => []);
    }

    return NextResponse.json({
      success: true,
      media,
      stories,
      mentions,
    });
  } catch (err) {
    if (err instanceof InstagramMetaError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireProjectRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.mediaId || typeof body.mediaId !== "string") {
      return NextResponse.json({ error: "mediaId is required" }, { status: 400 });
    }

    const { accessToken, tokenType } = await loadCloudConfig(ctx.projectId);
    const updates: { comment_enabled?: boolean; caption?: string } = {};
    if (typeof body.comment_enabled === "boolean") {
      updates.comment_enabled = body.comment_enabled;
    }
    if (typeof body.caption === "string") {
      updates.caption = body.caption;
    }

    await updateInstagramMedia(accessToken, body.mediaId, updates, tokenType);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof InstagramMetaError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

