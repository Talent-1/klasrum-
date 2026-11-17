import "server-only";

import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missingVariables: string[] = [];

  if (!supabaseUrl) {
    missingVariables.push(
      "NEXT_PUBLIC_SUPABASE_URL"
    );
  }

  if (!serviceRoleKey) {
    missingVariables.push(
      "SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing Supabase environment variables: ${missingVariables.join(", ")}`
    );
  }

  return createClient(
    supabaseUrl!,
    serviceRoleKey!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}