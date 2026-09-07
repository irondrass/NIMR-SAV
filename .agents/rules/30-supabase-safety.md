# RULE 30: NIMR-SAV SUPABASE PRODUCTION SAFETY

## 1. Dual Boundary Model
The agent must strictly distinguish:
- **Boundary A: Local Source Code Changes** (Editing SQL migration files, `supabase-schema.sql`, `js/supabase-client.js`, `supabase/functions/*`).
- **Boundary B: Live Supabase Mutations** (Applying migrations remotely, executing SQL against live database, modifying live RLS policies, deploying live Edge Functions).

Local editing is permitted within task scope. Live Supabase mutation is strictly gated.

## 2. Prohibitions Without Explicit Live Authorization
Without explicit, written user authorization, the agent must NEVER:
- Execute SQL queries (DDL or DML) against a live Supabase instance.
- Apply remote migrations (`supabase db push`, `supabase migration apply`).
- Modify live Row Level Security (RLS) policies.
- Deploy Edge Functions (`supabase functions deploy`).
- Alter Supabase authentication settings, email templates, or redirect URLs.
- Modify production database secrets or environment variables.
- Execute administrative or service-role RPCs.
- Insert, update, or delete live production records.

## 3. Mandatory Impact Declaration
Every task involving Supabase files or database interactions must include in its report:

```
SUPABASE IMPACT: [NONE | LOCAL ONLY | LIVE READ-ONLY | LIVE MUTATION REQUIRED]
```

If **LIVE MUTATION REQUIRED**: The agent must STOP and request explicit authorization before proceeding.

## 4. RLS & Least Privilege Principle
- Public anonymous access (`anon` role) must NEVER have mutation access to workshop data.
- Authenticated client operations must be scoped by `workshop_id` and user role.
- Edge Functions handling administrative actions (`workshop-user-admin`) must enforce caller JWT verification and role authorization on the server side.
- No service-role key or admin secret may ever be embedded in client-side code.
