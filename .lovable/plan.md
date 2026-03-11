

## Diagnosis

The investigation reveals a critical finding: **the `auth-service` edge function's retry logic code was never actually deployed** (or is running a stale version).

### Evidence

1. **Edge function logs show ZERO register/login activity.** Only `confirm_all_users` actions appear in the logs. If the updated code (with `[auth-service:register] START signIn...` logging) were deployed, those log lines would appear for every registration.

2. **Auth logs confirm the edge function IS being called** — we see `/admin/users` POST calls with `actor_username: "service_role"` creating users, immediately followed by `/token` POST calls failing with "Email not confirmed." This means the old version of `handleRegister` is running: it creates the user, attempts sign-in, but has no retry logic and no diagnostic logging.

3. **Two Supabase project IDs exist in this repo:**
   - `igmkhxffnyzoogcqvdab` — Lovable Cloud (`.env`, web frontend, test scripts)
   - `ecqpqtirhpumfgbdtvhh` — appears in `config.toml` and `pooler-url` (likely legacy/external)
   
   The `config.toml` `project_id` mismatch (`ecqpqtirhpumfgbdtvhh` vs the actual Cloud project `igmkhxffnyzoogcqvdab`) may be causing edge function deployments to target the wrong project or fail silently.

### Root Cause

The updated `auth-service/index.ts` with auto-confirm retry logic exists in the codebase but is **not the version running in production**. The stale deployed version creates the user but returns success without a session when sign-in fails.

## Plan

### 1. Force-redeploy `auth-service` edge function
Trigger a fresh deployment of the current `auth-service/index.ts` code and verify deployment success by checking that the new diagnostic logs (`[auth-service:register] START`) appear in subsequent calls.

### 2. Verify deployment with a live test
After deployment, call the edge function directly via curl to confirm:
- The new log lines appear in edge function logs
- The auto-confirm retry logic actually fires
- A real session/token is returned on registration

### 3. Investigate the `config.toml` project ID mismatch
The `config.toml` references project `ecqpqtirhpumfgbdtvhh` while the actual Cloud project is `igmkhxffnyzoogcqvdab`. This mismatch needs to be understood — it may be why previous deployments appeared to succeed but the running functions remained stale.

