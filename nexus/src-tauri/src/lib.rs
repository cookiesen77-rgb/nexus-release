use sha2::{Digest, Sha256};
use serde_json::Value;
use base64::{engine::general_purpose, Engine as _};
use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use std::sync::mpsc::{Receiver, Sender, channel, RecvTimeoutError};
use std::thread;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

const IMAGE_CACHE_DIR: &str = "nexus-image-cache";
const MEDIA_CACHE_DIR: &str = "nexus-media-cache";
const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_MEDIA_BYTES: u64 = 300 * 1024 * 1024;
const REQUEST_TIMEOUT_SECS: u64 = 60;
const MEDIA_DOWNLOAD_TIMEOUT_SECS: u64 = 300; // 视频下载需要更长时间

fn hash_key(key: &str) -> String {
  let mut hasher = Sha256::new();
  hasher.update(key.as_bytes());
  hex::encode(hasher.finalize())
}

fn canvas_store_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?
    .join("nexus-canvas");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

fn canvas_store_path(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
  let dir = canvas_store_dir(app)?;
  Ok(dir.join(format!("{}.json", hash_key(project_id))))
}

#[derive(Debug)]
struct CanvasSaveRequest {
  project_id: String,
  canvas: Value,
}

static CANVAS_SAVE_SENDER: OnceLock<Sender<CanvasSaveRequest>> = OnceLock::new();

// ======== Editor export jobs (FFmpeg sidecar) ========

#[derive(serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct EditorExportClip {
  #[serde(default)]
  input: String, // local path preferred; fallback: http(s) url
  #[serde(default)]
  in_sec: f64,
  #[serde(default)]
  out_sec: Option<f64>,
  #[serde(default)]
  shot_id: String,
  #[serde(default)]
  video_variant_id: String,
}

#[derive(Clone)]
struct EditorExportJobState {
  cancel: Arc<AtomicBool>,
  child: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
}

static EDITOR_EXPORT_JOBS: OnceLock<Mutex<HashMap<String, EditorExportJobState>>> = OnceLock::new();

fn editor_export_jobs() -> &'static Mutex<HashMap<String, EditorExportJobState>> {
  EDITOR_EXPORT_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn ensure_canvas_save_worker(app: tauri::AppHandle) -> Sender<CanvasSaveRequest> {
  if let Some(sender) = CANVAS_SAVE_SENDER.get() {
    return sender.clone();
  }

  let (tx, rx) = channel::<CanvasSaveRequest>();
  let _ = CANVAS_SAVE_SENDER.set(tx.clone());
  thread::spawn(move || canvas_save_worker(app, rx));
  tx
}

fn canvas_save_worker(app: tauri::AppHandle, rx: Receiver<CanvasSaveRequest>) {
  let mut pending: HashMap<String, Value> = HashMap::new();
  let debounce = Duration::from_millis(650);

  loop {
    match rx.recv_timeout(debounce) {
      Ok(r) => {
        pending.insert(r.project_id, r.canvas);
        continue;
      }
      Err(RecvTimeoutError::Timeout) => {}
      Err(RecvTimeoutError::Disconnected) => break,
    }

    if pending.is_empty() {
      continue;
    }

    let batch = std::mem::take(&mut pending);
    for (project_id, canvas) in batch {
      let _ = save_project_canvas_to_disk_blocking(&app, project_id, canvas);
    }
  }

  if pending.is_empty() {
    return;
  }
  let batch = std::mem::take(&mut pending);
  for (project_id, canvas) in batch {
    let _ = save_project_canvas_to_disk_blocking(&app, project_id, canvas);
  }
}

fn save_project_canvas_to_disk_blocking(app: &tauri::AppHandle, project_id: String, canvas: Value) -> Result<(), String> {
  if project_id.trim().is_empty() {
    return Err("projectId 不能为空".to_string());
  }

  let path = canvas_store_path(app, &project_id)?;
  let bytes = serde_json::to_vec(&canvas).map_err(|e| e.to_string())?;
  let tmp = path.with_extension(format!("json.tmp.{}", std::process::id()));
  std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
  if let Err(err) = std::fs::rename(&tmp, &path) {
    if path.exists() {
      let _ = std::fs::remove_file(&path);
      if let Err(err2) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(err2.to_string());
      }
    } else {
      let _ = std::fs::remove_file(&tmp);
      return Err(err.to_string());
    }
  }
  Ok(())
}

fn sanitize_extension(ext: &str) -> Option<String> {
  let trimmed = ext.trim().trim_start_matches('.').to_ascii_lowercase();
  if trimmed.len() < 2 || trimmed.len() > 6 {
    return None;
  }
  if !trimmed.chars().all(|c| c.is_ascii_alphanumeric()) {
    return None;
  }
  Some(trimmed)
}

fn extension_from_url(url: &str) -> Option<String> {
  let parsed = reqwest::Url::parse(url).ok()?;
  let ext = Path::new(parsed.path()).extension()?.to_str()?;
  sanitize_extension(ext)
}

fn extension_from_content_type(content_type: Option<&str>) -> Option<String> {
  let ct = content_type?.to_ascii_lowercase();
  let ext = if ct.starts_with("image/png") {
    "png"
  } else if ct.starts_with("image/jpeg") || ct.starts_with("image/jpg") {
    "jpg"
  } else if ct.starts_with("image/webp") {
    "webp"
  } else if ct.starts_with("image/gif") {
    "gif"
  } else if ct.starts_with("image/svg+xml") {
    "svg"
  } else if ct.starts_with("image/avif") {
    "avif"
  } else if ct.starts_with("image/heic") {
    "heic"
  } else if ct.starts_with("image/heif") {
    "heif"
  } else if ct.starts_with("video/mp4") {
    "mp4"
  } else if ct.starts_with("video/webm") {
    "webm"
  } else if ct.starts_with("video/quicktime") {
    "mov"
  } else if ct.starts_with("audio/mpeg") {
    "mp3"
  } else if ct.starts_with("audio/mp4") || ct.starts_with("audio/m4a") {
    "m4a"
  } else if ct.starts_with("audio/wav") {
    "wav"
  } else {
    return None;
  };

  Some(ext.to_string())
}

// 根据 URL 路径推断媒体类型（用于没有扩展名的 URL）
fn extension_from_url_path(url: &str) -> Option<String> {
  let lower = url.to_ascii_lowercase();
  // OpenAI Sora 视频内容端点
  if lower.contains("/videos/") && lower.contains("/content") {
    return Some("mp4".to_string());
  }
  None
}

#[tauri::command(rename_all = "camelCase")]
async fn save_project_canvas(app: tauri::AppHandle, project_id: String, canvas: Value) -> Result<(), String> {
  let app_clone = app.clone();
  tauri::async_runtime::spawn_blocking(move || save_project_canvas_to_disk_blocking(&app_clone, project_id, canvas))
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
async fn enqueue_save_project_canvas(app: tauri::AppHandle, project_id: String, canvas: Value) -> Result<(), String> {
  if project_id.trim().is_empty() {
    return Err("projectId 不能为空".to_string());
  }
  let sender = ensure_canvas_save_worker(app);
  sender
    .send(CanvasSaveRequest { project_id, canvas })
    .map_err(|_| "画布保存队列已关闭".to_string())?;
  Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn compress_json_lz4_base64(value: Value) -> Result<String, String> {
  let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
  let compressed = lz4_flex::compress_prepend_size(&bytes);
  Ok(general_purpose::STANDARD.encode(compressed))
}

#[tauri::command(rename_all = "camelCase")]
fn decompress_json_lz4_base64(b64: String) -> Result<Value, String> {
  let compressed = general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
  let decompressed = lz4_flex::decompress_size_prepended(&compressed).map_err(|e| e.to_string())?;
  let value: Value = serde_json::from_slice(&decompressed).map_err(|e| e.to_string())?;
  Ok(value)
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct MemoryItem {
  #[serde(default)]
  id: String,
  #[serde(default)]
  content: String,
  #[serde(default)]
  importance: f32,
  #[serde(default)]
  updated_at: i64,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
  role: String,
  content: String,
}

#[derive(serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct GraphNode {
  id: String,
  #[serde(rename = "type")]
  node_type: String,
  #[serde(default)]
  data: Value,
}

#[derive(serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct GraphEdge {
  source: String,
  target: String,
  #[serde(default)]
  data: Option<Value>,
}

#[derive(serde::Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct UpstreamTextBlock {
  id: String,
  label: String,
  text: String,
  target: String,
}

#[derive(serde::Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct UpstreamImageBlock {
  id: String,
  label: String,
  role: String,
  url: String,
  target: String,
}

#[derive(serde::Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct UpstreamInputs {
  text: Vec<UpstreamTextBlock>,
  images: Vec<UpstreamImageBlock>,
}

fn normalize_text(text: &str) -> String {
  text.replace("\r\n", "\n").trim().to_string()
}

fn safe_slice(text: &str, max_chars: usize) -> String {
  let t = normalize_text(text);
  if t.is_empty() {
    return t;
  }
  if t.chars().count() <= max_chars {
    return t;
  }
  let mut out = String::new();
  for (i, ch) in t.chars().enumerate() {
    if i >= max_chars {
      break;
    }
    out.push(ch);
  }
  out.push('…');
  out
}

fn value_string(value: Option<&Value>, key: &str) -> String {
  let v = value.and_then(|v| v.get(key)).and_then(|v| v.as_str()).unwrap_or("");
  normalize_text(v)
}

fn is_cjk(ch: char) -> bool {
  ('\u{4E00}'..='\u{9FFF}').contains(&ch)
}

fn tokenize(text: &str) -> Vec<String> {
  let t = normalize_text(text).to_lowercase();
  if t.is_empty() {
    return vec![];
  }

  let mut tokens: Vec<String> = vec![];
  let mut buf = String::new();
  for ch in t.chars() {
    if is_cjk(ch) {
      if !buf.is_empty() {
        for part in buf.split(|c: char| !(c.is_ascii_alphanumeric())) {
          if !part.is_empty() {
            tokens.push(part.to_string());
          }
        }
        buf.clear();
      }
      tokens.push(ch.to_string());
      continue;
    }
    buf.push(ch);
  }
  if !buf.is_empty() {
    for part in buf.split(|c: char| !(c.is_ascii_alphanumeric())) {
      if !part.is_empty() {
        tokens.push(part.to_string());
      }
    }
  }
  tokens
}

fn score_match(query: &str, doc: &str) -> f32 {
  let q = tokenize(query);
  let d = tokenize(doc);
  if q.is_empty() || d.is_empty() {
    return 0.0;
  }
  let qset: std::collections::HashSet<String> = q.into_iter().collect();
  let dset: std::collections::HashSet<String> = d.into_iter().collect();
  let mut hit = 0.0;
  for tok in qset.iter() {
    if dset.contains(tok) {
      hit += 1.0;
    }
  }
  let denom = ((qset.len() as f32) * (dset.len() as f32)).sqrt().max(1.0);
  hit / denom
}

#[tauri::command(rename_all = "camelCase")]
fn graph_collect_upstream_inputs(focus_node_id: String, nodes: Vec<GraphNode>, edges: Vec<GraphEdge>) -> UpstreamInputs {
  let focus_id = focus_node_id.trim().to_string();
  if focus_id.is_empty() {
    return UpstreamInputs::default();
  }

  let mut node_by_id: HashMap<String, GraphNode> = HashMap::new();
  for n in nodes.into_iter() {
    if !n.id.trim().is_empty() {
      node_by_id.insert(n.id.clone(), n);
    }
  }
  if !node_by_id.contains_key(&focus_id) {
    return UpstreamInputs::default();
  }

  let mut incoming: HashMap<String, Vec<GraphEdge>> = HashMap::new();
  let mut outgoing: HashMap<String, Vec<GraphEdge>> = HashMap::new();
  for e in edges.into_iter() {
    if e.source.trim().is_empty() || e.target.trim().is_empty() {
      continue;
    }
    incoming.entry(e.target.clone()).or_default().push(e.clone());
    outgoing.entry(e.source.clone()).or_default().push(e);
  }

  let mut config_targets: Vec<String> = vec![];
  if let Some(out) = outgoing.get(&focus_id) {
    for e in out.iter() {
      if let Some(t) = node_by_id.get(&e.target) {
        if t.node_type == "imageConfig" || t.node_type == "videoConfig" {
          config_targets.push(t.id.clone());
        }
      }
    }
  }

  let mut out_text: Vec<UpstreamTextBlock> = vec![];
  let mut out_images: Vec<UpstreamImageBlock> = vec![];
  let mut seen_text: std::collections::HashSet<String> = std::collections::HashSet::new();
  let mut seen_image: std::collections::HashSet<String> = std::collections::HashSet::new();

  for cfg_id in config_targets.iter() {
    let in_edges = incoming.get(cfg_id).cloned().unwrap_or_default();
    for e in in_edges.iter() {
      if let Some(src) = node_by_id.get(&e.source) {
        if src.node_type == "text" {
          if src.id == focus_id {
            continue;
          }
          if seen_text.contains(&src.id) {
            continue;
          }
          let content = value_string(Some(&src.data), "content");
          if content.is_empty() {
            continue;
          }
          let label = value_string(Some(&src.data), "label");
          out_text.push(UpstreamTextBlock {
            id: src.id.clone(),
            label: if label.is_empty() { "文本节点".to_string() } else { label },
            text: safe_slice(&content, 520),
            target: cfg_id.clone(),
          });
          seen_text.insert(src.id.clone());
        } else if src.node_type == "image" {
          if seen_image.contains(&src.id) {
            continue;
          }
          let label = value_string(Some(&src.data), "label");
          let url = value_string(Some(&src.data), "url");
          let role = value_string(e.data.as_ref(), "imageRole");
          out_images.push(UpstreamImageBlock {
            id: src.id.clone(),
            label: if label.is_empty() { "参考图".to_string() } else { label },
            role: if role.is_empty() { "input_reference".to_string() } else { role },
            url: if url.starts_with("data:") { "".to_string() } else { safe_slice(&url, 240) },
            target: cfg_id.clone(),
          });
          seen_image.insert(src.id.clone());
        }
      }
    }
  }

  UpstreamInputs { text: out_text, images: out_images }
}

#[tauri::command(rename_all = "camelCase")]
fn search_memory(query: String, items: Vec<MemoryItem>, limit: Option<usize>, min_score: Option<f32>) -> Vec<MemoryItem> {
  let q = normalize_text(&query);
  if q.is_empty() {
    return vec![];
  }
  let limit = limit.unwrap_or(6).max(1);
  let min_score = min_score.unwrap_or(0.12);
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0);

  let mut scored: Vec<(f32, MemoryItem)> = items
    .into_iter()
    .map(|mut item| {
      item.content = normalize_text(&item.content);
      let base = score_match(&q, &item.content);
      let importance = item.importance.clamp(0.0, 1.0);
      let recency_days = if item.updated_at > 0 {
        ((now - item.updated_at) as f32) / (1000.0 * 60.0 * 60.0 * 24.0)
      } else {
        30.0
      };
      let recency = (recency_days / 30.0).clamp(0.0, 1.0);
      let recency_boost = 1.0 - recency;
      let score = base * 0.7 + importance * 0.2 + recency_boost * 0.1;
      (score, item)
    })
    .filter(|(s, _)| *s >= min_score)
    .collect();

  scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
  scored.into_iter().take(limit).map(|(_, i)| i).collect()
}

#[derive(serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct ContextConfig {
  #[serde(default)]
  max_chars: i64,
  #[serde(default)]
  max_history: i64,
  #[serde(default)]
  max_memory_items: i64,
  #[serde(default)]
  max_canvas_chars: i64,
  #[serde(default)]
  max_memory_chars: i64,
  #[serde(default)]
  max_summary_chars: i64,
}

fn clamp_i64(n: i64, a: i64, b: i64) -> i64 {
  n.max(a).min(b)
}

fn estimate_chars(messages: &[ChatMessage]) -> usize {
  messages.iter().map(|m| m.content.len()).sum()
}

fn compact_lines(lines: &[String], max_chars: usize) -> String {
  let mut out: Vec<String> = vec![];
  let mut used = 0usize;
  for line in lines {
    let t = normalize_text(line);
    if t.is_empty() {
      continue;
    }
    if used + t.len() > max_chars {
      break;
    }
    used += t.len();
    out.push(t);
  }
  out.join("\n")
}

#[tauri::command(rename_all = "camelCase")]
fn build_chat_messages(
  user_text: String,
  system_prompt: String,
  conversation: Vec<ChatMessage>,
  memory_summary: String,
  memory_items: Vec<MemoryItem>,
  canvas_context: String,
  config: Option<ContextConfig>,
) -> Vec<ChatMessage> {
  let user_query = normalize_text(&user_text);
  let sys = normalize_text(&system_prompt);

  let cfg = config.unwrap_or_default();
  let max_chars = clamp_i64(if cfg.max_chars > 0 { cfg.max_chars } else { 12000 }, 2000, 50000) as usize;
  let max_history = clamp_i64(if cfg.max_history > 0 { cfg.max_history } else { 16 }, 4, 64) as usize;
  let max_memory_items = clamp_i64(if cfg.max_memory_items > 0 { cfg.max_memory_items } else { 6 }, 0, 30) as usize;
  let max_canvas_chars = clamp_i64(if cfg.max_canvas_chars > 0 { cfg.max_canvas_chars } else { 1200 }, 0, 8000) as usize;
  let max_memory_chars = clamp_i64(if cfg.max_memory_chars > 0 { cfg.max_memory_chars } else { 1200 }, 0, 8000) as usize;
  let max_summary_chars = clamp_i64(if cfg.max_summary_chars > 0 { cfg.max_summary_chars } else { 600 }, 0, 4000) as usize;

  let mut out: Vec<ChatMessage> = vec![];
  if !sys.is_empty() {
    out.push(ChatMessage { role: "system".to_string(), content: sys.clone() });
  }

  let mem_summary = normalize_text(&memory_summary);
  if !mem_summary.is_empty() && max_summary_chars > 0 {
    out.push(ChatMessage {
      role: "system".to_string(),
      content: format!("【长期记忆摘要】\n{}", mem_summary.chars().take(max_summary_chars).collect::<String>()),
    });
  }

  if !memory_items.is_empty() && max_memory_items > 0 && max_memory_chars > 0 {
    let mut lines: Vec<String> = vec![];
    for m in memory_items.iter().take(max_memory_items) {
      let c = normalize_text(&m.content);
      if c.is_empty() {
        continue;
      }
      let snippet: String = c.chars().take(260).collect();
      lines.push(format!("- {}", snippet));
    }
    let packed = compact_lines(&lines, max_memory_chars);
    if !packed.is_empty() {
      out.push(ChatMessage {
        role: "system".to_string(),
        content: format!("【长期记忆（检索命中）】\n{}", packed),
      });
    }
  }

  let canvas = normalize_text(&canvas_context);
  if !canvas.is_empty() && max_canvas_chars > 0 {
    out.push(ChatMessage {
      role: "system".to_string(),
      content: format!("【当前项目上下文】\n{}", canvas.chars().take(max_canvas_chars).collect::<String>()),
    });
  }

  // history: keep last max_history, keep order
  let filtered: Vec<ChatMessage> = conversation
    .into_iter()
    .filter(|m| !m.role.is_empty() && m.role != "system" && !normalize_text(&m.content).is_empty())
    .collect();
  let start = filtered.len().saturating_sub(max_history);
  for m in filtered.iter().skip(start) {
    out.push(ChatMessage { role: m.role.clone(), content: normalize_text(&m.content) });
  }

  out.push(ChatMessage { role: "user".to_string(), content: user_query.clone() });

  // compress if exceed budget
  if estimate_chars(&out) <= max_chars {
    return out;
  }

  // fallback: keep fewer history
  let keep_history = clamp_i64((max_history as i64) / 2, 2, max_history as i64) as usize;
  let start2 = filtered.len().saturating_sub(keep_history);
  let mut base: Vec<ChatMessage> = vec![];
  if !sys.is_empty() {
    base.push(ChatMessage { role: "system".to_string(), content: sys.clone() });
  }
  if !mem_summary.is_empty() && max_summary_chars > 0 {
    base.push(ChatMessage {
      role: "system".to_string(),
      content: format!("【长期记忆摘要】\n{}", mem_summary.chars().take(max_summary_chars.min(360)).collect::<String>()),
    });
  }
  if !canvas.is_empty() {
    base.push(ChatMessage {
      role: "system".to_string(),
      content: format!("【当前项目上下文】\n{}", canvas.chars().take(360).collect::<String>()),
    });
  }
  for m in filtered.iter().skip(start2) {
    base.push(ChatMessage { role: m.role.clone(), content: normalize_text(&m.content) });
  }
  base.push(ChatMessage { role: "user".to_string(), content: user_query.clone() });

  if estimate_chars(&base) <= max_chars {
    return base;
  }

  // final: system + user
  let mut minimal: Vec<ChatMessage> = vec![];
  if !sys.is_empty() {
    minimal.push(ChatMessage { role: "system".to_string(), content: sys });
  }
  minimal.push(ChatMessage { role: "user".to_string(), content: user_query });
  minimal
}

#[tauri::command(rename_all = "camelCase")]
async fn load_project_canvas(app: tauri::AppHandle, project_id: String) -> Result<Option<Value>, String> {
  if project_id.trim().is_empty() {
    return Ok(None);
  }

  let path = canvas_store_path(&app, &project_id)?;

  tauri::async_runtime::spawn_blocking(move || -> Result<Option<Value>, String> {
    if !path.exists() {
      return Ok(None);
    }
    let raw = std::fs::read(&path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    Ok(Some(value))
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
async fn delete_project_canvas(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
  if project_id.trim().is_empty() {
    return Ok(());
  }
  let path = canvas_store_path(&app, &project_id)?;
  tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
    if path.exists() {
      std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
  })
  .await
  .map_err(|e| e.to_string())??;
  Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn cache_remote_image(
  app: tauri::AppHandle,
  url: String,
  auth_token: Option<String>,
) -> Result<String, String> {
  if url.starts_with("data:") || url.starts_with("blob:") {
    return Ok(url);
  }

  let cache_root = app
    .path()
    .app_cache_dir()
    .map_err(|e| e.to_string())?
    .join(IMAGE_CACHE_DIR);

  std::fs::create_dir_all(&cache_root).map_err(|e| e.to_string())?;

  let token_ref = auth_token.as_deref().unwrap_or("");
  let mut hasher = Sha256::new();
  hasher.update(url.as_bytes());
  if !token_ref.is_empty() {
    hasher.update(token_ref.as_bytes());
  }
  let hash = hex::encode(hasher.finalize());
  let file_stem = format!("image-{}", hash);

  if let Some(ext) = extension_from_url(&url) {
    let cached = cache_root.join(format!("{}.{}", file_stem, ext));
    if cached.exists() {
      return Ok(cached.to_string_lossy().to_string());
    }
  }

  let client = reqwest::Client::builder()
    .user_agent("Nexus/1.0")
    .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
    .connect_timeout(Duration::from_secs(30))
    .pool_max_idle_per_host(5)
    .build()
    .map_err(|e| e.to_string())?;

  let mut request = client.get(&url);
  if !token_ref.is_empty() {
    request = request.header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token_ref));
  }

  log::info!("[cache_remote_image] 开始下载: {}", &url[..url.len().min(80)]);
  let response = request.send().await.map_err(|e| {
    log::error!("[cache_remote_image] 请求失败: {}", e);
    e.to_string()
  })?;
  if !response.status().is_success() {
    log::error!("[cache_remote_image] HTTP 错误: {}", response.status());
    return Err(format!("HTTP {}", response.status()));
  }

  let content_type = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .map(|v| v.to_string());

  let bytes = response.bytes().await.map_err(|e| {
    log::error!("[cache_remote_image] 读取响应失败: {}", e);
    e.to_string()
  })?;
  if bytes.len() as u64 > MAX_IMAGE_BYTES {
    log::error!("[cache_remote_image] 图片过大: {} bytes", bytes.len());
    return Err("图片过大，已拒绝缓存".to_string());
  }
  let ext = extension_from_url(&url)
    .or_else(|| extension_from_content_type(content_type.as_deref()))
    .unwrap_or_else(|| "png".to_string());
  let target = cache_root.join(format!("{}.{}", file_stem, ext));

  log::info!("[cache_remote_image] Content-Type: {:?}, 扩展名: {}, 大小: {} bytes", content_type, ext, bytes.len());

  if !target.exists() {
    std::fs::write(&target, &bytes).map_err(|e| {
      log::error!("[cache_remote_image] 写入文件失败: {}", e);
      e.to_string()
    })?;
  }

  log::info!("[cache_remote_image] 缓存成功: {}", target.to_string_lossy());
  Ok(target.to_string_lossy().to_string())
}

#[tauri::command(rename_all = "camelCase")]
async fn cache_remote_media(
  app: tauri::AppHandle,
  url: String,
  auth_token: Option<String>,
) -> Result<String, String> {
  if url.starts_with("data:") || url.starts_with("blob:") {
    return Ok(url);
  }

  let cache_root = app
    .path()
    .app_cache_dir()
    .map_err(|e| e.to_string())?
    .join(MEDIA_CACHE_DIR);

  std::fs::create_dir_all(&cache_root).map_err(|e| e.to_string())?;

  let token_ref = auth_token.as_deref().unwrap_or("");
  let mut hasher = Sha256::new();
  hasher.update(url.as_bytes());
  if !token_ref.is_empty() {
    hasher.update(token_ref.as_bytes());
  }
  let hash = hex::encode(hasher.finalize());
  let file_stem = format!("media-{}", hash);

  if let Some(ext) = extension_from_url(&url) {
    let cached = cache_root.join(format!("{}.{}", file_stem, ext));
    if cached.exists() {
      return Ok(cached.to_string_lossy().to_string());
    }
  }

  // 视频下载需要更长的超时时间
  let client = reqwest::Client::builder()
    .user_agent("Nexus/1.0")
    .timeout(Duration::from_secs(MEDIA_DOWNLOAD_TIMEOUT_SECS))
    .connect_timeout(Duration::from_secs(30))
    .pool_max_idle_per_host(5)
    .build()
    .map_err(|e| e.to_string())?;

  let mut request = client.get(&url);
  if !token_ref.is_empty() {
    request = request.header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token_ref));
  }

  log::info!("[cache_remote_media] 开始下载: {}", &url[..url.len().min(80)]);
  let response = request.send().await.map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    log::error!("[cache_remote_media] HTTP 错误: {}", response.status());
    return Err(format!("HTTP {}", response.status()));
  }

  let content_type = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .map(|v| v.to_string());

  // 扩展名优先级：URL 扩展名 > Content-Type > URL 路径推断 > 默认 mp4
  let ext = extension_from_url(&url)
    .or_else(|| extension_from_content_type(content_type.as_deref()))
    .or_else(|| extension_from_url_path(&url))
    .unwrap_or_else(|| "mp4".to_string()); // 默认 mp4 而不是 bin
  
  log::info!("[cache_remote_media] Content-Type: {:?}, 扩展名: {}", content_type, ext);
  let target = cache_root.join(format!("{}.{}", file_stem, ext));

  if target.exists() {
    return Ok(target.to_string_lossy().to_string());
  }

  let mut file = tokio::fs::File::create(&target).await.map_err(|e| e.to_string())?;
  let mut size: u64 = 0;
  let mut stream = response.bytes_stream();
  while let Some(chunk) = stream.next().await {
    let bytes = chunk.map_err(|e| e.to_string())?;
    size += bytes.len() as u64;
    if size > MAX_MEDIA_BYTES {
      let _ = tokio::fs::remove_file(&target).await;
      log::error!("[cache_remote_media] 文件过大: {} bytes", size);
      return Err("媒体文件过大，已拒绝缓存".to_string());
    }
    file.write_all(&bytes).await.map_err(|e| e.to_string())?;
  }
  file.flush().await.map_err(|e| e.to_string())?;

  log::info!("[cache_remote_media] 下载完成: {} bytes -> {}", size, target.to_string_lossy());
  Ok(target.to_string_lossy().to_string())
}

#[derive(serde::Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct EditorExportProgressPayload {
  job_id: String,
  status: String,   // running | done | error | cancelled
  progress: u32,    // 0..100
  phase: String,    // prepare | segment | concat | finalize
  message: String,
  output_path: Option<String>,
}

fn emit_editor_export(app: &tauri::AppHandle, payload: EditorExportProgressPayload) {
  // ignore errors when no listeners
  let _ = app.emit("nexus:editor-export-progress", payload);
}

fn sanitize_seconds(v: f64) -> f64 {
  if !v.is_finite() || v < 0.0 { 0.0 } else { v }
}

async fn run_ffmpeg_sidecar(app: &tauri::AppHandle, job: &EditorExportJobState, args: Vec<String>) -> Result<(), String> {
  // 优先使用 Tauri sidecar（打包自带），失败时回退到系统 PATH
  let (mut rx, child) = match app.shell().sidecar("ffmpeg") {
    Ok(cmd) => match cmd.args(args.clone()).spawn() {
      Ok(res) => res,
      Err(err) => {
        log::warn!("[editor_export] sidecar ffmpeg 启动失败，回退系统 PATH: {err}");
        app
          .shell()
          .command("ffmpeg")
          .args(args)
          .spawn()
          .map_err(|e| format!("未找到 FFmpeg（已尝试 sidecar 与系统 PATH）：{e}"))?
      }
    },
    Err(err) => {
      log::warn!("[editor_export] sidecar ffmpeg 不可用，回退系统 PATH: {err}");
      app
        .shell()
        .command("ffmpeg")
        .args(args)
        .spawn()
        .map_err(|e| format!("未找到 FFmpeg（已尝试 sidecar 与系统 PATH）：{e}"))?
    }
  };
  {
    let mut guard = job.child.lock().map_err(|_| "导出任务锁异常".to_string())?;
    *guard = Some(child);
  }

  let mut exit_code: Option<i32> = None;
  while let Some(event) = rx.recv().await {
    match event {
      CommandEvent::Terminated(payload) => {
        exit_code = payload.code;
        break;
      }
      _ => {}
    }
  }

  {
    let mut guard = job.child.lock().map_err(|_| "导出任务锁异常".to_string())?;
    *guard = None;
  }

  match exit_code {
    Some(0) => Ok(()),
    Some(code) => Err(format!("FFmpeg 退出码：{code}")),
    None => Err("FFmpeg 进程异常结束".to_string()),
  }
}

async fn editor_export_worker(
  app: tauri::AppHandle,
  job_id: String,
  project_id: String,
  output_path: String,
  mode: String,
  clips: Vec<EditorExportClip>,
  auth_token: Option<String>,
  job: EditorExportJobState,
) -> Result<(), String> {
  let total = clips.len().max(1);

  emit_editor_export(
    &app,
    EditorExportProgressPayload {
      job_id: job_id.clone(),
      status: "running".to_string(),
      progress: 0,
      phase: "prepare".to_string(),
      message: format!("准备导出（{total} 段）..."),
      output_path: Some(output_path.clone()),
    },
  );

  // temp dir
  let tmp_root = app
    .path()
    .app_cache_dir()
    .map_err(|e| e.to_string())?
    .join("nexus-editor-export")
    .join(&job_id);
  std::fs::create_dir_all(&tmp_root).map_err(|e| e.to_string())?;

  // ensure output dir exists
  if let Some(parent) = Path::new(&output_path).parent() {
    if !parent.as_os_str().is_empty() {
      std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
  }

  let token = auth_token.clone();
  let mut segment_paths: Vec<PathBuf> = Vec::new();

  for (idx, clip) in clips.iter().enumerate() {
    if job.cancel.load(Ordering::Relaxed) {
      emit_editor_export(
        &app,
        EditorExportProgressPayload {
          job_id: job_id.clone(),
          status: "cancelled".to_string(),
          progress: 0,
          phase: "finalize".to_string(),
          message: "已取消导出".to_string(),
          output_path: Some(output_path.clone()),
        },
      );
      let _ = std::fs::remove_dir_all(&tmp_root);
      return Ok(());
    }

    let progress = ((idx as f64) / (total as f64) * 80.0).round() as u32;
    emit_editor_export(
      &app,
      EditorExportProgressPayload {
        job_id: job_id.clone(),
        status: "running".to_string(),
        progress,
        phase: "segment".to_string(),
        message: format!("切片 {}/{}（mode: {}）", idx + 1, total, mode),
        output_path: Some(output_path.clone()),
      },
    );

    let mut input = String::from(clip.input.trim());
    if input.is_empty() {
      return Err(format!("第 {} 段输入为空（shotId={}, variantId={}）", idx + 1, clip.shot_id, clip.video_variant_id));
    }

    // If input is http(s), cache it first (stable for FFmpeg)
    if input.starts_with("http://") || input.starts_with("https://") {
      input = cache_remote_media(app.clone(), input, token.clone()).await?;
    }

    if input.starts_with("data:") || input.starts_with("blob:") || input.starts_with("asset://") {
      return Err("导出仅支持本地文件路径或 http(s) URL（请先缓存为本地文件）".to_string());
    }

    if !Path::new(&input).exists() {
      return Err(format!("输入文件不存在：{input}"));
    }

    let start = sanitize_seconds(clip.in_sec);
    let end = clip.out_sec.map(sanitize_seconds);
    let dur = match end {
      Some(v) if v > start => Some(v - start),
      _ => None,
    };

    let seg_path = tmp_root.join(format!("segment_{:03}.mp4", idx));
    let mut args: Vec<String> = Vec::new();
    args.push("-y".into());

    if mode == "accurate" {
      args.push("-i".into());
      args.push(input.clone());
      args.push("-ss".into());
      args.push(format!("{start:.3}"));
      if let Some(d) = dur {
        args.push("-t".into());
        args.push(format!("{d:.3}"));
      }
      // Re-encode for precise cuts & uniform codec
      args.push("-c:v".into());
      args.push("libx264".into());
      args.push("-preset".into());
      args.push("veryfast".into());
      args.push("-crf".into());
      args.push("18".into());
      args.push("-pix_fmt".into());
      args.push("yuv420p".into());
      args.push("-c:a".into());
      args.push("aac".into());
      args.push("-b:a".into());
      args.push("192k".into());
      args.push("-movflags".into());
      args.push("+faststart".into());
    } else {
      // fast (lossless-ish): stream copy, may snap to keyframes
      args.push("-ss".into());
      args.push(format!("{start:.3}"));
      args.push("-i".into());
      args.push(input.clone());
      if let Some(d) = dur {
        args.push("-t".into());
        args.push(format!("{d:.3}"));
      }
      args.push("-c".into());
      args.push("copy".into());
      args.push("-avoid_negative_ts".into());
      args.push("make_zero".into());
    }

    args.push(seg_path.to_string_lossy().to_string());
    run_ffmpeg_sidecar(&app, &job, args).await?;
    segment_paths.push(seg_path);
  }

  if job.cancel.load(Ordering::Relaxed) {
    emit_editor_export(
      &app,
      EditorExportProgressPayload {
        job_id: job_id.clone(),
        status: "cancelled".to_string(),
        progress: 0,
        phase: "finalize".to_string(),
        message: "已取消导出".to_string(),
        output_path: Some(output_path.clone()),
      },
    );
    let _ = std::fs::remove_dir_all(&tmp_root);
    return Ok(());
  }

  emit_editor_export(
    &app,
    EditorExportProgressPayload {
      job_id: job_id.clone(),
      status: "running".to_string(),
      progress: 90,
      phase: "concat".to_string(),
      message: "合并片段...".to_string(),
      output_path: Some(output_path.clone()),
    },
  );

  // concat demuxer list
  let list_path = tmp_root.join("list.txt");
  let mut list_txt = String::new();
  for p in &segment_paths {
    let s = p.to_string_lossy().replace('\\', "/");
    list_txt.push_str(&format!("file '{}'\n", s.replace('\'', "\\'")));
  }
  std::fs::write(&list_path, list_txt).map_err(|e| e.to_string())?;

  // concat
  let mut args: Vec<String> = Vec::new();
  args.push("-y".into());
  args.push("-f".into());
  args.push("concat".into());
  args.push("-safe".into());
  args.push("0".into());
  args.push("-i".into());
  args.push(list_path.to_string_lossy().to_string());
  args.push("-c".into());
  args.push("copy".into());
  args.push(output_path.clone());
  run_ffmpeg_sidecar(&app, &job, args).await?;

  emit_editor_export(
    &app,
    EditorExportProgressPayload {
      job_id: job_id.clone(),
      status: "done".to_string(),
      progress: 100,
      phase: "finalize".to_string(),
      message: format!("导出完成：{output_path}"),
      output_path: Some(output_path.clone()),
    },
  );

  // best-effort cleanup
  let _ = std::fs::remove_dir_all(&tmp_root);
  log::info!("[editor_export] done, project_id={}, job_id={}, output={}", project_id, job_id, output_path);
  Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn editor_export_start(
  app: tauri::AppHandle,
  project_id: String,
  output_path: String,
  mode: String,
  clips: Vec<EditorExportClip>,
  auth_token: Option<String>,
) -> Result<String, String> {
  if project_id.trim().is_empty() {
    return Err("projectId 不能为空".to_string());
  }
  if output_path.trim().is_empty() {
    return Err("outputPath 不能为空".to_string());
  }
  if clips.is_empty() {
    return Err("时间线为空，无法导出".to_string());
  }

  let mode_norm = if mode.trim().eq_ignore_ascii_case("accurate") { "accurate" } else { "fast" }.to_string();
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis();
  let job_id = format!("export-{}-{}", hash_key(&project_id), now);

  let state = EditorExportJobState {
    cancel: Arc::new(AtomicBool::new(false)),
    child: Arc::new(Mutex::new(None)),
  };

  {
    let mut map = editor_export_jobs().lock().map_err(|_| "导出任务锁异常".to_string())?;
    map.insert(job_id.clone(), state.clone());
  }

  let app_clone = app.clone();
  let job_id_clone = job_id.clone();
  let project_id_clone = project_id.clone();
  let output_clone = output_path.clone();
  let clips_clone = clips.clone();
  let auth_clone = auth_token.clone();
  let state_clone = state.clone();

  tauri::async_runtime::spawn(async move {
    let res = editor_export_worker(
      app_clone.clone(),
      job_id_clone.clone(),
      project_id_clone,
      output_clone,
      mode_norm,
      clips_clone,
      auth_clone,
      state_clone,
    )
    .await;

    if let Err(err) = res {
      emit_editor_export(
        &app_clone,
        EditorExportProgressPayload {
          job_id: job_id_clone.clone(),
          status: "error".to_string(),
          progress: 0,
          phase: "finalize".to_string(),
          message: format!("导出失败：{err}"),
          output_path: None,
        },
      );
    }

    // cleanup job registry
    if let Ok(mut map) = editor_export_jobs().lock() {
      map.remove(&job_id_clone);
    }
  });

  Ok(job_id)
}

#[tauri::command(rename_all = "camelCase")]
fn editor_export_cancel(job_id: String) -> Result<(), String> {
  if job_id.trim().is_empty() {
    return Ok(());
  }
  let map = editor_export_jobs().lock().map_err(|_| "导出任务锁异常".to_string())?;
  if let Some(job) = map.get(job_id.trim()) {
    job.cancel.store(true, Ordering::Relaxed);
    // best-effort kill current child
    if let Ok(mut guard) = job.child.lock() {
      if let Some(child) = guard.take() {
        let _ = child.kill();
      }
    }
  }
  Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn log_frontend(level: String, message: String, context: Option<String>) {
  let detail = if let Some(ctx) = context {
    if ctx.trim().is_empty() {
      message
    } else {
      format!("{message} | {ctx}")
    }
  } else {
    message
  };

  match level.as_str() {
    "trace" => log::trace!("[frontend] {detail}"),
    "debug" => log::debug!("[frontend] {detail}"),
    "warn" | "warning" => log::warn!("[frontend] {detail}"),
    "error" => log::error!("[frontend] {detail}"),
    _ => log::info!("[frontend] {detail}")
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      let level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
      } else {
        log::LevelFilter::Info
      };
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(level)
          .max_file_size(2 * 1024 * 1024)
          .build(),
      )?;
      log::info!("Nexus app started");
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      cache_remote_image,
      cache_remote_media,
      editor_export_start,
      editor_export_cancel,
      log_frontend,
      save_project_canvas,
      enqueue_save_project_canvas,
      compress_json_lz4_base64,
      decompress_json_lz4_base64,
      graph_collect_upstream_inputs,
      search_memory,
      build_chat_messages,
      load_project_canvas,
      delete_project_canvas
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
