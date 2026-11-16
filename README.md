# Klasrum PWA starter

A responsive, installable school-management PWA starter built with Next.js App Router, Tailwind CSS and Supabase.

## Included
- Responsive admin, teacher and student dashboard shells.
- Class and student workspace, teacher assignment preview, attendance register, score entry with CA/Exam totals, class broadsheet export, publishing controls and scratch-card portal UI.
- PWA manifest, app icon and basic offline shell cache.
- Supabase multi-tenant SQL migration with school-scoped foreign keys and RLS policies.
- `.env.example` for Supabase configuration.

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env.local` and add your Supabase project URL and anon key.
3. Run `npm install`, then `npm run dev`.
4. Open `http://localhost:3000`.

## Connect Supabase
1. Create a Supabase project.
2. Run `supabase/migrations/0001_klasrum_schema.sql` in the SQL Editor.
3. Set trusted `app_metadata.school_id` and `app_metadata.role` for each user from a trusted server/admin process. Never authorize from editable `user_metadata`.
4. Implement server-side actions/Edge Functions for profile provisioning, teacher assignments, score writes, publishing, report generation and scratch-card validation.
5. Replace demo state in `src/app/page.tsx` with authenticated Supabase queries and mutations.

## Important security and scope notes
This download is a working UI prototype/starter, not a production-ready multi-tenant service. The dashboard currently uses sample in-browser data; it does not persist records or authenticate real users. Scratch-card validation and card generation are intentionally not implemented in the browser.

The SQL uses `app_metadata` rather than the prompt's `user_metadata` claim. This is deliberate: users can edit their own `user_metadata`, so it must not be trusted for tenant authorization. Tenant membership and role must be assigned only by a trusted server using Supabase service credentials. Never expose the service-role key in the browser.

Before production, review every RLS policy with separate test users from two schools. Also refine teacher/student policies for each table and expose publishing and scratch-card consumption only through hardened server-side functions with rate limiting and audit logging.
