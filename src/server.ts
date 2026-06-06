import express from "express";
import path from "path";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { promises as fs, createWriteStream } from "fs";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

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
  outro_image_url: z.string().url().or(z.literal("")).default(""),
  outro_duration: z.number().min(0).max(30).default(10),
});

type RenderBody = z.infer<typeof renderBodySchema>;

const EMOTION_COLOR: Record<string, string> = {
  hook: "#FF3B3B",
  emphasis: "#FFB020",
  punchline: "#FFE600",
  cta: "#22E27A",
};

const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime_s: Math.round(process.uptime()) });
});

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${url} -> ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(dest));
}

// Wrap caption into lines of ~maxChars chars without splitting words.
function wrapCaption(text: string, maxChars = 14): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.join("\n").toUpperCase();
}

// Escape text for ffmpeg drawtext textfile contents — drawtext interprets
// backslashes and percent signs. Using textfile= avoids the worst of arg
// escaping, but we still need to neutralize % and \.
function escapeForTextfile(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%");
}

function hexToFfmpeg(color: string): string {
  // ffmpeg accepts 0xRRGGBB or #RRGGBB; drawtext wants 0x form to be safe.
  const h = color.replace(/^#/, "");
  return `0x${h}`;
}

async function buildScene(
  tmp: string,
  idx: number,
  scene: RenderBody["scenes"][number],
): Promise<string> {
  const inputPath = path.join(tmp, `in_${idx}.mp4`);
  const audioPath = path.join(tmp, `aud_${idx}.mp3`);
  const outPath = path.join(tmp, `scene_${idx}.mp4`);
  const textPath = path.join(tmp, `text_${idx}.txt`);

  await Promise.all([
    download(scene.video_url, inputPath),
    download(scene.narration_url, audioPath),
  ]);

  const wrapped = wrapCaption(scene.caption, 14);
  await fs.writeFile(textPath, escapeForTextfile(wrapped), "utf8");

  const color = hexToFfmpeg(EMOTION_COLOR[scene.emotion] ?? "#FFFFFF");
  const fontsize = Math.round(scene.text_size);

  // Crop/scale source to 1080x1920, loop if shorter than duration, trim to duration.
  // Burn caption near bottom-center with thick black outline + shadow.
  const vf = [
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920`,
    `setsar=1`,
    `fps=30`,
    [
      `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`,
      `textfile='${textPath}'`,
      `fontcolor=${color}`,
      `fontsize=${fontsize}`,
      `borderw=6`,
      `bordercolor=black`,
      `shadowcolor=black@0.7`,
      `shadowx=0`,
      `shadowy=4`,
      `line_spacing=12`,
      `x=(w-text_w)/2`,
      `y=h*0.7-text_h/2`,
    ].join(":"),
  ].join(",");

  await run("ffmpeg", [
    "-y",
    "-stream_loop", "-1",
    "-i", inputPath,
    "-i", audioPath,
    "-t", scene.duration.toFixed(3),
    "-vf", vf,
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",
    "-ar", "44100",
    "-shortest",
    "-movflags", "+faststart",
    outPath,
  ]);

  return outPath;
}

async function buildOutro(
  tmp: string,
  imageUrl: string,
  duration: number,
): Promise<string> {
  const imgPath = path.join(tmp, "outro.png");
  const outPath = path.join(tmp, "outro.mp4");
  await download(imageUrl, imgPath);

  const vf = [
    `scale=720:-1`,
    `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0a`,
    `setsar=1`,
    `fps=30`,
  ].join(",");

  await run("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", imgPath,
    "-f", "lavfi",
    "-i", `anullsrc=channel_layout=stereo:sample_rate=44100`,
    "-t", duration.toFixed(3),
    "-vf", vf,
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
    outPath,
  ]);

  return outPath;
}

async function concatParts(tmp: string, parts: string[]): Promise<string> {
  const listPath = path.join(tmp, "list.txt");
  const outPath = path.join(tmp, "final.mp4");
  const body = parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, body, "utf8");
  await run("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    "-movflags", "+faststart",
    outPath,
  ]);
  return outPath;
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

async function doRender(payload: RenderBody) {
  const { project_id, render_id, scenes, outro_image_url, outro_duration } = payload;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-"));
  const t0 = Date.now();

  try {
    console.log(`[render ${render_id}] building ${scenes.length} scenes`);
    const parts: string[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const p = await buildScene(tmpDir, i, scenes[i]);
      parts.push(p);
      console.log(`[render ${render_id}] scene ${i + 1}/${scenes.length} done`);
    }

    if (outro_image_url && outro_duration > 0) {
      const outro = await buildOutro(tmpDir, outro_image_url, outro_duration);
      parts.push(outro);
      console.log(`[render ${render_id}] outro done`);
    }

    const finalPath = await concatParts(tmpDir, parts);
    console.log(`[render ${render_id}] concat done`);

    const data = await fs.readFile(finalPath);
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

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[render ${render_id}] done in ${dt}s -> ${video_url}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[render ${render_id}] failed:`, msg);
    await markFailed(project_id, msg);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

app.post("/render", async (req, res) => {
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

  doRender(parsed.data).catch((e) => console.error("doRender unhandled", e));
  res.json({ accepted: true, render_id: parsed.data.render_id });
});

app.listen(PORT, () => {
  console.log(`ffmpeg-worker listening on :${PORT}`);
});
