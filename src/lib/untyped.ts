import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Тот же клиент, но без сгенерированных типов: новые колонки и функции
 * (reply_to_id, edited_at, pinned_at, edit_message…) работают, не дожидаясь пересоздания types.ts.
 */
export const db = supabase as unknown as SupabaseClient;
