import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { promises as fs } from "fs";
import os from "os";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 10000);
const WORKER_SECRET = process.env.RENDER_WORKER_SECRET ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "tts-audio";

if (!WORKER_SECRET) console.warn("RENDER_WORKER_SECRET is not set — refusing all /render calls");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("Supabase credentials missing — uploads will fail");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const sceneSchema = z.object({
  scene: z.number(),
  caption: z.string(),
  narration: z.string(),
  emotion: z.enum(["hook", "emphasis", "punchline", "cta"]),
  duration: z.number().min(0.2).max(30),
  video_url: z.string().url(),
  narration_url: z.string().url(),
  highlight_words: z.array(z.string()).default([]),
  text_size: z.number().min(40).max(160).default(80),
});

const renderBodySchema = z.object({
  project_id: z.string().uuid(),
  render_id: z.string().min(1).max(128),
  scenes: z.array(sceneSchema).min(1).max(60),
  outro_image_url: z.string().url().default(""),
  outro_duration: z.number().min(0).max(30).default(10),
});

const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime_s: Math.round(process.uptime()) });
});

// Bundle Remotion once at boot — saves ~10s per render
let bundlePromise: Promise<string> | null = null;
async function getBundle() {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: path.resolve(__dirname, "index.ts"),
      webpackOverride: (c) => c,
    });
  }
  return bundlePromise;
}

async function markFailed(projectId: string, error: string) {
  try {
    await supabase
      .from("projects")
      .update({ status: "failed", error: error.slice(0, 800) })
      .eq("id", projectId);
  } catch (e) {
    console.error("Failed to update project status", e);
  }
}

async function doRender(payload: z.infer<typeof renderBodySchema>) {
  const { project_id, render_id, scenes, outro_image_url, outro_duration } = payload;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "remotion-"));
  const outPath = path.join(tmpDir, `${render_id}.mp4`);

  try {
    const serveUrl = await getBundle();
    const inputProps = { scenes, outro_image_url, outro_duration };

    const composition = await selectComposition({
      serveUrl,
      id: "main",
      inputProps,
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
      concurrency: 1,
      chromiumOptions: {
        gl: "swiftshader",
      },
    });

    const data = await fs.readFile(outPath);
    const objectPath = `renders/${project_id}/${render_id}.mp4`;
    const { error: upErr } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(objectPath, data, { contentType: "video/mp4", upsert: true });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { data: pub } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(objectPath);
    const video_url = pub.publicUrl;

    const { error: updErr } = await supabase
      .from("projects")
      .update({ status: "done", video_url })
      .eq("id", project_id);
    if (updErr) throw new Error(`DB update failed: ${updErr.message}`);

    console.log(`[render ${render_id}] done -> ${video_url}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[render ${render_id}] failed:`, msg);
    await markFailed(project_id, msg);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

app.post("/render", async (req, res) => {
  // Constant-time secret comparison
  const provided = String(req.header("x-worker-secret") ?? "");
  if (
    !WORKER_SECRET ||
    provided.length !== WORKER_SECRET.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(WORKER_SECRET))
  ) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const parsed = renderBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
  }

  // Fire-and-forget render — respond immediately
  doRender(parsed.data).catch((e) => console.error("doRender unhandled", e));

  res.json({ accepted: true, render_id: parsed.data.render_id });
});

app.listen(PORT, () => {
  console.log(`remotion-worker listening on :${PORT}`);
  // Warm the bundle
  getBundle().then(() => console.log("bundle ready")).catch((e) => console.error("bundle failed", e));
});
