-- ============================================================
-- Migration 055: Grant full permissions on pipelines & stages to service_role
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipelines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_stages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipelines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_stages TO authenticated;
