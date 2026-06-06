# FFmpeg Render Worker

Tiny Node + ffmpeg service that turns scene JSON into an MP4 reel and uploads it
to Supabase storage. Replaces the old Remotion worker — ~10× faster on the same
free Render.com tier (no browser, no Chromium, no `delayRender`).

## One-time deploy

1. Push this folder to a public GitHub repo (or fork it).
2. Render.com → **New → Blueprint** → connect the repo. `render.yaml` provisions
   a Docker web service on the free plan.
3. In the service's **Environment** tab set:
   - `RENDER_WORKER_SECRET` — any long random string (same value as in Lovable).
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. After first build (~2 min — just installs ffmpeg), copy the
   `https://*.onrender.com` URL and paste into Lovable's `RENDER_WORKER_URL`.

## API

### `GET /health` → `{ status: "ok" }`

### `POST /render`
Headers: `x-worker-secret: <RENDER_WORKER_SECRET>`. Same JSON body as before
(`project_id`, `render_id`, `scenes[]`, `outro_image_url`, `outro_duration`).
Responds immediately with `{ accepted: true }` and renders in the background.
On success/failure writes back to the `projects` row.

## How it renders

Per scene:
1. Download b-roll mp4 + narration mp3 in parallel.
2. ffmpeg: scale+crop to 1080x1920, loop if short, trim to scene duration,
   burn caption (DejaVu Sans Bold, emotion-colored, black outline) near the
   bottom-center, encode H.264 + AAC narration.

Then build a `0a0a0a` outro with the book cover centered, and concat all
parts with `-c copy` (no re-encode → fast).

Expected speed on Render free (0.1 vCPU): ~1× realtime, so a 30s reel renders
in ~30s. Upgrade to Starter ($7/mo, 0.5 vCPU) for ~5× realtime.
