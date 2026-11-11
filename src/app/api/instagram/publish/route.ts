import { NextRequest, NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  publishInstagramPost,
  publishInstagramReel,
  publishInstagramCarousel,
  publishInstagramStory,
  InstagramMetaError,
} from "@/lib/instagram/meta-client";
import type { InstagramTokenType } from "@/lib/instagram/types";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireProjectRole("agent");
    const body = await request.json().catch(() => null);

    const {
      type = "post", // "post" | "reel" | "carousel" | "story"
      mediaUrl,
      isVideo = false,
      carouselItems,
      caption = "",
      shareToFeed = true,
    } = body || {};

    // Retrieve Instagram configuration
    const { data: config, error: configError } = await supabaseAdmin()
      .from("instagram_config")
      .select("*")
      .eq("project_id", ctx.projectId)
      .eq("status", "connected")
      .maybeSingle();

    if (configError || !config) {
      return NextResponse.json(
        { error: "Instagram account is not connected for this project. Please connect first." },
        { status: 400 },
      );
    }

    if (config.connection_method !== "cloud_api") {
      return NextResponse.json({
        success: true,
        direct: true,
        message: "Direct account connected! Use Instagram Web Creator to upload Posts, Reels & Stories directly.",
        creatorUrl: "https://www.instagram.com/create/select/",
      });
    }

    if (!config.access_token) {
      return NextResponse.json(
        { error: "Meta Access Token is missing from configuration." },
        { status: 400 },
      );
    }

    const decryptedToken = decrypt(config.access_token);
    const businessId = config.instagram_business_id || "me";
    const tokenType = (config.token_type as InstagramTokenType | undefined) ?? null;

    let result: { mediaId: string };

    if (type === "carousel") {
      const items = Array.isArray(carouselItems) ? carouselItems : [];
      if (items.length < 2) {
        return NextResponse.json(
          { error: "Carousels require at least 2 uploaded photos or videos." },
          { status: 400 },
        );
      }
      result = await publishInstagramCarousel(
        decryptedToken,
        businessId,
        items.map((item: { url: string; mediaType?: string }) => ({
          url: String(item.url),
          mediaType: item.mediaType === "VIDEO" ? "VIDEO" : "IMAGE",
        })),
        caption.trim() || undefined,
        tokenType,
      );
    } else if (type === "story") {
      if (!mediaUrl || typeof mediaUrl !== "string") {
        return NextResponse.json(
          { error: "Image or Video URL is required to publish a Story." },
          { status: 400 },
        );
      }
      result = await publishInstagramStory(
        decryptedToken,
        businessId,
        mediaUrl.trim(),
        Boolean(isVideo),
        tokenType,
      );
    } else if (type === "reel") {
      if (!mediaUrl || typeof mediaUrl !== "string") {
        return NextResponse.json(
          { error: "Video URL is required to publish a Reel." },
          { status: 400 },
        );
      }
      result = await publishInstagramReel(
        decryptedToken,
        businessId,
        mediaUrl.trim(),
        caption.trim() || undefined,
        Boolean(shareToFeed),
        tokenType,
      );
    } else {
      if (!mediaUrl || typeof mediaUrl !== "string") {
        return NextResponse.json(
          { error: "Image URL is required to publish a Post." },
          { status: 400 },
        );
      }
      result = await publishInstagramPost(
        decryptedToken,
        businessId,
        mediaUrl.trim(),
        caption.trim() || undefined,
        tokenType,
      );
    }

    const label =
      type === "reel"
        ? "Reel"
        : type === "carousel"
        ? "Carousel"
        : type === "story"
        ? "Story"
        : "Post";

    return NextResponse.json({
      success: true,
      mediaId: result.mediaId,
      message: `${label} published successfully to Instagram!`,
    });
  } catch (err: unknown) {
    if (err instanceof InstagramMetaError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status || 400 },
      );
    }
    return toErrorResponse(err);
  }
}
