# Security Policy

## Supported Version

The `main` branch is the currently supported version.

## Reporting Security Issues

If you find a vulnerability, please avoid posting exploit details publicly. Open a private GitHub security advisory if available, or contact the repository owner directly.

## Safe Deployment Checklist

Before deploying a public copy:

- Keep `.env`, `.env.local`, `.env.production`, and other real environment files out of Git.
- Use only the Supabase anon key in frontend environment variables.
- Never use or expose a Supabase `service_role` key in frontend code.
- Enable Supabase Row Level Security on every table containing user data.
- Confirm authenticated users can only select, insert, update, and delete their own rows.
- Add only trusted production and local URLs to Supabase Auth redirect URLs.
- Protect the email account used for magic-link login.
- Do not commit Vercel project metadata or deployment tokens.

## Supabase Data Access Model

Forge stores synced app data in `public.app_snapshots`.

Each row is keyed by `user_id`, and Row Level Security policies should require:

- `auth.uid() = user_id` for reads
- `auth.uid() = user_id` for inserts
- `auth.uid() = user_id` for updates
- `auth.uid() = user_id` for deletes, if delete support is added

This means someone can open the public web app, but they should not be able to read or change another user's synced data.

## Frontend Visibility

All frontend JavaScript is visible to browser users after deployment. This is normal for web apps.

Do not place secrets in React, Vite, public assets, service workers, or any code sent to the browser.
