# Study Tracker V2

A free, GitHub Pages-hosted study dashboard with Supabase authentication and sync.

## Setup

1. Run the database schema in Supabase SQL Editor.
2. Copy the **Publishable key** from Supabase **Project Settings → API**.
3. Paste it in `config.js`. Never use a `service_role` or secret key in this project.
4. In **Authentication → URL Configuration**, add `https://gokul-12007.github.io/Study_Tracker_V2/` as the Site URL and a Redirect URL.
5. Publish this repository with GitHub Pages using the `main` branch and `/ (root)` folder.

## Security notes

- `vendor/supabase-2.117.2.js` is a pinned local copy of supabase-js (no third-party CDN script). Update it deliberately.
- Run `security_hardening.sql` in the Supabase SQL Editor. Row Level Security is what actually protects your data, not the publishable key.
- A Content-Security-Policy is set via `<meta>` in `index.html`. If you add another host (analytics, fonts, etc.), allow it there.
