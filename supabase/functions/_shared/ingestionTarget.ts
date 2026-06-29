/**
 * Ingestion Target Resolver
 * Reads `edge_function_base_url` from admin_settings to determine
 * where ingestion workers should be called (Live vs local).
 */

export interface IngestionTarget {
  targetBaseUrl: string;
  isRemoteTarget: boolean;
  localBaseUrl: string;
}

/**
 * Resolve ingestion target from admin_settings.
 * If edge_function_base_url is set and differs from the current env,
 * isRemoteTarget = true and calls should go to targetBaseUrl.
 */
export async function resolveIngestionTarget(
  supabase: any
): Promise<IngestionTarget> {
  const localBaseUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

  const { data: setting } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", "edge_function_base_url")
    .maybeSingle();

  const configuredUrl = setting?.value?.trim();

  if (!configuredUrl) {
    console.log("[ingestionTarget] No edge_function_base_url configured, using local");
    return { targetBaseUrl: localBaseUrl, isRemoteTarget: false, localBaseUrl };
  }

  // Extract project ref from URLs to compare
  const localRef = extractProjectRef(localBaseUrl);
  const targetRef = extractProjectRef(configuredUrl);

  const isRemote = localRef !== targetRef && !!targetRef;

  console.log(
    `[ingestionTarget] local=${localRef} target=${targetRef} isRemote=${isRemote} url=${configuredUrl}`
  );

  return {
    targetBaseUrl: configuredUrl,
    isRemoteTarget: isRemote,
    localBaseUrl,
  };
}

function extractProjectRef(url: string): string | null {
  try {
    const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

/**
 * Build headers for calling a remote worker (service role auth).
 */
export function buildWorkerHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
  };
}

/**
 * Build headers for calling a remote import endpoint (cron auth).
 */
export function buildCronHeaders(): Record<string, string> {
  // Include the remote project's anon key so the Supabase gateway accepts the request
  const remoteAnonKey = Deno.env.get("REMOTE_ANON_KEY") || "";
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  return {
    "Content-Type": "application/json",
    ...(cronSecret ? { "x-internal-cron-key": cronSecret } : {}),
    ...(remoteAnonKey ? {
      "apikey": remoteAnonKey,
      "Authorization": `Bearer ${remoteAnonKey}`,
    } : {}),
  };
}
