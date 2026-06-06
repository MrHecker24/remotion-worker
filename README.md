# Remotion Render Worker

Tiny Node service that turns scene JSON into an MP4 reel and uploads it to Supabase storage.
Replaces Creatomate — fully free on Render.com's free web-service tier (or ~$7/mo for an always-on instance).

## One-time deploy (5 min)

1. Push this folder to a public GitHub repo (or fork it).
2. Go to https://render.com → **New → Blueprint** → connect the repo.
   Render reads `render.yaml` and provisions a Docker web service on the free plan.
3. In the new service's **Environment** tab, set these secrets (the blueprint
   marks them `sync: false` so they aren't committed):
   - `RENDER_WORKER_SECRET` — any long random string. Paste the same value into
     Lovable's `RENDER_WORKER_SECRET` secret.
   - `SUPABASE_URL` — your project's Supabase URL (e.g. `https://srboxnxykltplzyugvkk.supabase.co`).
   - `SUPABASE_SERVICE_ROLE_KEY` — service-role key from Supabase project settings.
4. Wait for the first build (~5 min — pulls Chromium + ffmpeg).
5. Copy the public URL Render assigns (`https://remotion-worker-xxxx.onrender.com`)
   and paste it into Lovable's `RENDER_WORKER_URL` secret.

That's it. Lovable's `generate-video` edge function will POST scene JSON to
`${RENDER_WORKER_URL}/render` and the worker writes the finished MP4 URL back
to your Supabase `projects` table.

## API

### `GET /health`
Returns `{ status: "ok" }`. Used by Lovable's API Status panel.

### `POST /render`
Headers: `x-worker-secret: <RENDER_WORKER_SECRET>`

Body:
```json
{
  "project_id": "uuid",
  "render_id": "uuid",
  "scenes": [{ "scene": 1, "caption": "...", "narration": "...", "emotion": "hook",
               "duration": 3.4, "video_url": "https://...", "narration_url": "https://...",
               "highlight_words": ["WORD"], "text_size": 80 }],
  "outro_image_url": "https://..."
}
```

Returns immediately with `{ accepted: true, render_id }` and renders in the background.
On success, writes `{ status: "done", video_url }` to the matching `projects` row.
On failure, writes `{ status: "failed", error }`.

## Free-tier notes

- Free Render web services sleep after 15 min of inactivity (~30s cold start
  on first render after sleep).
- Upgrade to the Starter plan ($7/mo) for always-on.
- The free tier has 0.1 vCPU which renders ~30s of 1080x1920 video in ~60-90s.
