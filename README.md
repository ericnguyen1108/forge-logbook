# Forge Logbook

Forge Logbook is a mobile-first fitness tracker for body weight, calories, macros, workouts, rest days, and adaptive calorie recommendations.

It is built as a Vite + React progressive web app, so it can run in the browser and be installed to a phone home screen.

## Features

- Daily weigh-ins, calories, macros, workout sessions, and rest-day logging
- Weight trend, 7-day averages, checkpoint changes, expenditure, energy balance, and calorie balance charts
- Weekly calorie recommendation logic based on logged intake and trend-weight change
- Optional Supabase sync across devices using email magic-link login
- Installable PWA support for iPhone and Android
- Light and dark themes

## Safety Model

The app is safe to open source because it does not store production credentials in the repository.

- Real environment values belong in `.env` or hosting provider environment variables.
- `.env` and `.env.*` are ignored by Git.
- `.env.example` contains placeholders only.
- Supabase anon keys are allowed in frontend apps, but only if Row Level Security is enabled.
- Never expose a Supabase `service_role` key in this app, GitHub, Vercel, or browser code.

Synced user data is protected by Supabase Auth plus Row Level Security policies that restrict each user to their own `app_snapshots` row.

## Local Development

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Then add your own Supabase project URL and anon key to `.env`.

Run locally:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

## Supabase Setup

See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for the table, Row Level Security policies, and auth redirect settings.

## Security

Please see [SECURITY.md](./SECURITY.md) before deploying your own copy.

## License

MIT. See [LICENSE](./LICENSE).
