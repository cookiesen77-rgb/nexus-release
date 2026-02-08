#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const mode = process.argv.includes("--required") ? "required" : "optional"
const root = process.cwd()
const binDir = path.join(root, "src-tauri", "binaries")

const targetByPlatform = {
  "darwin:x64": { triple: "x86_64-apple-darwin", exe: "" },
  "darwin:arm64": { triple: "aarch64-apple-darwin", exe: "" },
  "win32:x64": { triple: "x86_64-pc-windows-msvc", exe: ".exe" },
  "linux:x64": { triple: "x86_64-unknown-linux-gnu", exe: "" },
  "linux:arm64": { triple: "aarch64-unknown-linux-gnu", exe: "" },
}

const platformKey = `${process.platform}:${process.arch}`
const target = targetByPlatform[platformKey]

if (!target) {
  console.log(`[ffmpeg-sidecar] Skip: unsupported platform ${platformKey}`)
  process.exit(0)
}

const sidecarPath = path.join(binDir, `ffmpeg-${target.triple}${target.exe}`)

function isUsableBinary(filePath) {
  try {
    const stat = fs.statSync(filePath)
    return stat.isFile() && stat.size > 1024 * 256
  } catch {
    return false
  }
}

function resolveFfmpegPath() {
  const envPath = String(process.env.FFMPEG_PATH || "").trim()
  if (envPath && fs.existsSync(envPath)) return envPath

  if (process.platform === "win32") {
    const out = spawnSync("where", ["ffmpeg"], { encoding: "utf8" })
    if (out.status === 0) {
      const first = String(out.stdout || "").split(/\r?\n/).find(Boolean)
      if (first && fs.existsSync(first.trim())) return first.trim()
    }
  } else {
    const out = spawnSync("which", ["ffmpeg"], { encoding: "utf8" })
    if (out.status === 0) {
      const p = String(out.stdout || "").trim()
      if (p && fs.existsSync(p)) return p
    }

    const candidates = [
      "/opt/homebrew/bin/ffmpeg",
      "/usr/local/bin/ffmpeg",
      "/usr/bin/ffmpeg",
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
  }

  return ""
}

fs.mkdirSync(binDir, { recursive: true })

if (isUsableBinary(sidecarPath)) {
  console.log(`[ffmpeg-sidecar] Ready: ${path.relative(root, sidecarPath)}`)
  process.exit(0)
}

const ffmpegPath = resolveFfmpegPath()
if (!ffmpegPath) {
  const msg = "[ffmpeg-sidecar] ffmpeg not found. Install ffmpeg or set FFMPEG_PATH to enable bundled export."
  if (mode === "required") {
    console.error(msg)
    process.exit(1)
  }
  console.warn(msg)
  process.exit(0)
}

try {
  fs.copyFileSync(ffmpegPath, sidecarPath)
  if (process.platform !== "win32") {
    fs.chmodSync(sidecarPath, 0o755)
  }
  console.log(`[ffmpeg-sidecar] Prepared ${path.relative(root, sidecarPath)} from ${ffmpegPath}`)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[ffmpeg-sidecar] Failed to prepare sidecar: ${message}`)
  process.exit(1)
}
