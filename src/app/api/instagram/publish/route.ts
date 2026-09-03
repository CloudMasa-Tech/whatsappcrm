import { NextRequest, NextResponse } from "next/server";
import { getCurrentProject } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  publishInstagramPost,
  publishInstagramReel,
  InstagramMetaError,
} from "@/lib/instagram/meta-client";

export async function POST(request: NextRequest) {
  try {
    const ctx = await getCurrentProject();
    const body = await request.json().catch(() => null);

    const {
      type = "post", // "post" | "reel"
      mediaUrl,
      caption = "",
      shareToFeed = true,
    } = body || {};

    if (!mediaUrl || typeof mediaUrl !== "string") {
      return NextResponse.json(
        { error: "Media URL (Image or Video) is required to publish." },
        { status: 400 },
      );
    }

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

    if (config.connection_method === "cloud_api") {
      if (!config.access_token) {
        return NextResponse.json(
          { error: "Meta Access Token is missing from configuration." },
          { status: 400 },
        );
      }

      const businessId = config.instagram_business_id || "me";

      let result: { mediaId: string };
      if (type === "reel") {
        result = await publishInstagramReel(
          config.access_token,
          businessId,
          mediaUrl.trim(),
          caption.trim() || undefined,
          shareToFeed,
        );
      } else {
        result = await publishInstagramPost(
          config.access_token,
          businessId,
          mediaUrl.trim(),
          caption.trim() || undefined,
        );
      }

      return NextResponse.json({
        success: true,
        mediaId: result.mediaId,
        message: type === "reel" ? "Reel published successfully to Instagram!" : "Post published successfully to Instagram!",
      });
    }

    // For Direct Login connection: Return instructions and link to direct creator
    return NextResponse.json({
      success: true,
      direct: true,
      message: "Direct account connected! Use the Web Creator to upload files directly from your computer.",
      creatorUrl: "https://www.instagram.com/create/select/",
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
