# Nova Run Log — Vercel + Supabase

## 1. Create a Supabase project (free tier)
1. Go to supabase.com → sign up / log in → "New Project"
2. Pick a name, a database password (save it somewhere), and a region close to you
3. Wait ~2 min for it to provision

## 2. Create the table
1. In your Supabase project, go to the **SQL Editor** in the left sidebar
2. Open `supabase-setup.sql` from this project, copy its contents, paste into a new query, click **Run**

## 3. Get your API keys
1. In Supabase: **Project Settings → API**
2. Copy the **Project URL** and the **service_role** key (marked "secret", *not* the anon/public one) — you'll need both in step 5

## 4. Push this project to GitHub
1. Create a new repo at github.com (e.g. `nova-run-log`)
2. Upload all these files to it (drag-and-drop on the GitHub website works fine for this size, or use `git push` if you're comfortable with it)

## 5. Deploy on Vercel
1. Go to vercel.com → log in with GitHub → **Add New → Project**
2. Import the `nova-run-log` repo
3. Before deploying, expand **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = (the Project URL from step 3)
   - `SUPABASE_SERVICE_ROLE_KEY` = (the service_role key from step 3 — server-side only, never exposed to the browser)
4. Click **Deploy**

Vercel will detect it's a Vite project automatically. In a minute or two you'll get a live URL like `nova-run-log.vercel.app`.

## 6. Test it
Open the URL, log a dummy run, then open the same URL on a second device (or a private browser window). The run should show up there within about 20 seconds, or immediately if you switch back to that tab (it re-checks whenever it regains focus) — or tap the refresh icon for an instant pull.

## Notes
- This app has no login — anyone with the URL can view and edit the data through the app itself. That's fine for personal use, but don't share the link publicly if you'd rather keep it private. What *is* locked down: the database has Row Level Security enabled with no public policies, so nobody can query it directly (bypassing the app) even if they got hold of a key from the app's public code — every read/write is mediated by the server using a secret key that never reaches the browser.
- To add it to your iPhone home screen: open the Vercel URL in Safari → Share → Add to Home Screen. Since this is now a real manifest you control, it'll show the correct name and icon (no more "Claude AI" issue).
