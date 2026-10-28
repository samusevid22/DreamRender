/**
 * Host half of the Neural video studio bundle.
 *
 * The studio is a two-call pipeline over the profile's own model route:
 *   1. the model plans a short film (title, 2-3 scenes, engines, durations);
 *   2. for every scene it writes the renderer — Canvas2D drawing code for a 2D
 *      scene, a WebGL1 fragment shader for a 3D scene.
 *
 * The browser half receives that project, compiles the code in a sandboxed
 * iframe, renders the frames in real time and records them with MediaRecorder.
 * This half never renders or writes video: it only turns a prompt into code.
 *
 * Two callers share one operation, as the plugin practices require: the studio
 * panel posts to the exact Fetch route below, and the `neural_video_generate`
 * tool calls the same service method for the agent.
 */

/** Exact Fetch routes; they must live below the connection's `/api` channel. */
const GENERATE_PATH = '/api/neural-video-studio/generate'
const REFINE_PATH = '/api/neural-video-studio/refine'
const INFO_PATH = '/api/neural-video-studio/info'

const MAX_PROMPT_CHARS = 4000
const MAX_SCENES = 4
const MAX_REFINE_SCENES = 6
const MAX_INSTRUCTION_CHARS = 2000
const MIN_DURATION = 2
const MAX_DURATION = 60
const MAX_SCENE_DURATION = 30
const PLAN_MAX_TOKENS = 6000
const CODE_MAX_TOKENS = 8192
const AUDIO_MAX_TOKENS = 4096
const DEFAULT_TIMEOUT_MS = 300_000

const MODES = ['2d', '3d', 'mixed']
const ENGINES = ['2d', '3d', 'mesh']
const MODEL_KINDS = ['humanoid', 'creature', 'vehicle', 'object', 'architecture', 'other']

/** One failure a route or the tool renders as its reason. */
class StudioError extends Error {
  /**
   * @param {string} code - stable machine code the client may branch on.
   * @param {string} message - human-readable reason.
   * @param {number} status - HTTP status for the Fetch route.
   */
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'StudioError'
    this.code = code
    this.status = status
  }
}

/**
 * Resolve the target model route: an explicit config pair wins, then the
 * profile's default model selection, then the first registered provider.
 * @param {any} ctx - Host context with optional `llm` and `agentDefaultModel`.
 * @param {{ provider?: string, model?: string }} settings - plugin config.
 * @returns {Promise<{ provider: string, model: string, llm: any }>} route to call.
 */
async function resolveRoute(ctx, settings) {
  const llm = ctx.get('llm')
  if (llm === undefined) {
    throw new StudioError('LLM_MISSING', 'The LLM service is unavailable in this profile.', 503)
  }
  const providers = llm.listProviders()
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new StudioError('LLM_PROVIDER_MISSING', 'No LLM provider is registered in this profile.', 503)
  }
  const known = new Set(providers.map(row => row.id))
  let provider
  let model
  if (settings.provider !== undefined && known.has(settings.provider)) {
    provider = settings.provider
    model = settings.model
  }
  if (provider === undefined) {
    const selection = ctx.get('agentDefaultModel')?.currentSelection()
    if (selection !== undefined && known.has(selection.provider)) {
      provider = selection.provider
      model = model ?? selection.model
    }
  }
  if (provider === undefined) provider = providers[0].id
  if (model === undefined || model === '') {
    let models = []
    try {
      models = await llm.listModels(provider)
    } catch {
      models = []
    }
    model = Array.isArray(models) && models.length > 0 ? models[0].id : undefined
  }
  if (typeof model !== 'string' || model === '') {
    throw new StudioError('LLM_MODEL_MISSING', `Provider "${provider}" exposes no model to call.`, 503)
  }
  return { provider, model, llm }
}

/**
 * Run one model call and collect its assistant text.
 * Thinking is kept off: the film plan and the renderer code are bulk output,
 * and a reasoning budget would compete with the answer for output tokens.
 * @param {any} route - resolved provider, model and llm service.
 * @param {{ system: string, user: string, maxTokens: number, temperature?: number }} request - call shape.
 * @param {AbortSignal} signal - caller and deadline cancellation.
 * @returns {Promise<string>} the assembled text, trimmed by callers.
 */
async function collectText(route, request, signal) {
  const messages = [{ role: 'user', content: [{ type: 'text', text: request.user }] }]
  /**
   * Run one streaming attempt and assemble its text.
   * @param {Record<string, unknown>} controls - extra request controls.
   * @returns {Promise<{ text: string, finish: any }>} assembled answer and terminal reason.
   */
  async function attempt(controls) {
    const deltas = []
    const blocks = []
    let finish
    const stream = route.llm.stream({
      provider: route.provider,
      model: route.model,
      system: request.system,
      messages,
      maxTokens: request.maxTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      signal,
      ...controls,
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') deltas.push(chunk.text)
      else if (chunk.type === 'block-end' && chunk.block.type === 'text') blocks.push(chunk.block.text)
      else if (chunk.type === 'finish') finish = chunk.reason
    }
    return { text: deltas.join('').length > 0 ? deltas.join('') : blocks.join(''), finish }
  }
  let result
  try {
    // Thinking is kept off: the film plan and the renderer code are bulk output,
    // and a reasoning budget would compete with the answer for output tokens.
    result = await attempt({ reasoningEffort: 'off' })
  } catch (error) {
    if (signal.aborted) throw abortReason(signal)
    const reason = error instanceof Error ? error.message : String(error)
    if (!/effort|reasoning|thinking/i.test(reason)) {
      throw new StudioError('LLM_REQUEST_FAILED', `The model request failed: ${reason}`, 502)
    }
    // A route whose catalog does not declare the 'off' effort still renders fine
    // with the adapter defaults; only the explicit control is unavailable there.
    try {
      result = await attempt({})
    } catch (second) {
      if (signal.aborted) throw abortReason(signal)
      const secondReason = second instanceof Error ? second.message : String(second)
      throw new StudioError('LLM_REQUEST_FAILED', `The model request failed: ${secondReason}`, 502)
    }
  }
  const { text, finish } = result
  if (finish !== undefined && finish.kind === 'error') {
    const reason = finish.failure?.message ?? 'unknown provider failure'
    throw new StudioError('LLM_REQUEST_FAILED', `The model request failed: ${reason}`, 502)
  }
  if (finish !== undefined && finish.kind === 'aborted') {
    throw abortReason(signal)
  }
  if (finish !== undefined && finish.kind === 'max-tokens') {
    throw new StudioError('LLM_TRUNCATED', 'The model answer was cut off by the output limit.', 502)
  }
  if (finish !== undefined && finish.kind === 'tool-calls') {
    throw new StudioError('LLM_UNEXPECTED_TOOLS', 'The model tried to call a tool instead of answering.', 502)
  }
  if (text.trim() === '') throw new StudioError('LLM_EMPTY', 'The model returned no text.', 502)
  return text
}

/**
 * Turn an aborted signal into the failure it represents.
 * @param {AbortSignal} signal - aborted signal.
 * @returns {StudioError} timeout, cancellation or a generic abort.
 */
function abortReason(signal) {
  const reason = signal.reason
  if (reason instanceof StudioError) return reason
  if (reason instanceof Error && reason.name === 'StudioTimeout') {
    return new StudioError('TIMEOUT', 'Generating this film took too long. Try a shorter prompt or a shorter video.', 504)
  }
  return new StudioError('CANCELLED', 'Generation was cancelled.', 499)
}

/**
 * Clamp one numeric request field.
 * @param {unknown} value - raw input.
 * @param {number} min - inclusive lower bound.
 * @param {number} max - inclusive upper bound.
 * @param {number} fallback - value for a non-numeric input.
 * @returns {number} the clamped number.
 */
function clampNumber(value, min, max, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/**
 * Shorten and normalize one model string field.
 * @param {unknown} value - raw model output.
 * @param {number} limit - maximum character count.
 * @returns {string} the trimmed text, never longer than the limit.
 */
function shortText(value, limit) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, limit)
}

/**
 * Validate and normalize the mesh summary a loaded model contributes: name,
 * triangle count, the client's classification guess and its part segmentation.
 * @param {unknown} value - `{ name, triangles, kind, parts, analysis }` or nothing.
 * @returns {any | undefined} the accepted summary.
 */
function normalizeMeshInfo(value) {
  if (value === null || typeof value !== 'object') return undefined
  const name = shortText(value.name, 120)
  const triangles = Math.round(clampNumber(value.triangles, 1, 4_000_000, 0))
  if (name === '' || triangles < 1) return undefined
  const kind = MODEL_KINDS.includes(value.kind) ? value.kind : 'object'
  const parts = []
  if (Array.isArray(value.parts)) {
    for (const item of value.parts.slice(0, 8)) {
      if (item === null || typeof item !== 'object') continue
      const center = Array.isArray(item.center) && item.center.length >= 3
        ? item.center.slice(0, 3).map(axis => clampNumber(axis, -1_000_000, 1_000_000, 0))
        : [0, 0, 0]
      const size = Array.isArray(item.size) && item.size.length >= 3
        ? item.size.slice(0, 3).map(axis => clampNumber(axis, 0, 1_000_000, 0))
        : [0, 0, 0]
      parts.push({
        index: parts.length,
        center,
        size,
        share: clampNumber(item.share, 0, 1, 0),
        limb: clampNumber(item.limb, 0, 1, 0),
        mirror: Number.isInteger(item.mirror) && item.mirror >= 0 && item.mirror < 8 ? item.mirror : -1,
      })
    }
  }
  const analysis = value.analysis !== null && typeof value.analysis === 'object'
    ? {
      extents: Array.isArray(value.analysis.extents)
        ? value.analysis.extents.slice(0, 3).map(axis => clampNumber(axis, 0, 1_000_000, 0))
        : [],
      symmetry: clampNumber(value.analysis.symmetry, 0, 1, 0),
      limbParts: Math.round(clampNumber(value.analysis.limbParts, 0, 8, 0)),
    }
    : undefined
  return {
    name,
    triangles,
    kind,
    parts,
    ...(analysis === undefined ? {} : { analysis }),
  }
}

/**
 * Validate and normalize the browser request.
 * @param {unknown} input - parsed request body.
 * @returns {{ prompt: string, mode: string, durationSec: number, fps: number, width: number, height: number, style: string, continuation: string, mesh?: { name: string, triangles: number } }} accepted request.
 */
function normalizeRequest(input) {
  const raw = input !== null && typeof input === 'object' ? input : {}
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
  if (prompt.length < 3) throw new StudioError('INVALID_PROMPT', 'Describe the video first (at least 3 characters).', 400)
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new StudioError('INVALID_PROMPT', `The description is limited to ${MAX_PROMPT_CHARS} characters.`, 400)
  }
  const width = Math.round(clampNumber(raw.width, 320, 1920, 1280) / 2) * 2
  const height = Math.round(clampNumber(raw.height, 240, 1080, 720) / 2) * 2
  const mesh = normalizeMeshInfo(raw.mesh)
  return {
    prompt,
    mode: MODES.includes(raw.mode) ? raw.mode : 'mixed',
    durationSec: Math.round(clampNumber(raw.durationSec, MIN_DURATION, MAX_DURATION, 8) * 10) / 10,
    fps: Number(raw.fps) === 24 ? 24 : 30,
    width,
    height,
    style: shortText(raw.style, 200),
    continuation: shortText(raw.continuation, 600),
    sound: raw.sound !== false,
    ...(mesh === undefined ? {} : { mesh }),
  }
}

/**
 * Extract JSON from a model answer that may carry fences or a sentence around it.
 * @param {string} text - raw model output.
 * @returns {unknown} the parsed JSON value.
 */
function parsePlanJson(text) {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new StudioError('PLAN_INVALID', 'The model did not return a JSON plan. Try again.', 502)
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    throw new StudioError('PLAN_INVALID', 'The model returned malformed JSON for the film plan. Try again.', 502)
  }
}

/**
 * Normalize the model plan: engines follow the requested mode, durations are
 * scaled to the requested total, and scene count is capped.
 * @param {unknown} parsed - the model's JSON plan.
 * @param {ReturnType<typeof normalizeRequest>} request - validated request.
 * @returns {{ title: string, summary: string, style: string, scenes: Array<{ name: string, engine: string, durationSec: number, brief: string }> }} accepted plan.
 */
function normalizePlan(parsed, request) {
  const plan = parsed !== null && typeof parsed === 'object' ? parsed : {}
  const rawScenes = Array.isArray(plan.scenes) ? plan.scenes : []
  const scenes = []
  for (const item of rawScenes.slice(0, MAX_SCENES)) {
    if (item === null || typeof item !== 'object') continue
    let engine = ENGINES.includes(item.engine) ? item.engine : '2d'
    if (engine === 'mesh' && request.mesh === undefined) engine = '3d'
    if (request.mode === '2d') engine = '2d'
    else if (request.mode === '3d' && engine === '2d') engine = '3d'
    scenes.push({
      name: shortText(item.name, 40) || `Scene ${scenes.length + 1}`,
      engine,
      durationSec: clampNumber(item.durationSec, 1.5, MAX_SCENE_DURATION, 3),
      brief: shortText(item.brief, 400) || shortText(plan.summary, 300) || request.prompt,
    })
  }
  if (scenes.length === 0) {
    throw new StudioError('PLAN_EMPTY', 'The model planned no scenes. Try a more concrete description.', 502)
  }
  const total = scenes.reduce((sum, scene) => sum + scene.durationSec, 0)
  const scale = request.durationSec / total
  for (const scene of scenes) {
    scene.durationSec = Math.round(clampNumber(scene.durationSec * scale, 1.2, MAX_SCENE_DURATION, 2) * 10) / 10
  }
  return {
    title: shortText(plan.title, 80) || shortText(request.prompt, 60),
    summary: shortText(plan.summary, 300) || shortText(request.prompt, 300),
    style: shortText(plan.style, 120) || request.style,
    modelKind: request.mesh === undefined
      ? undefined
      : MODEL_KINDS.includes(plan.modelKind) ? plan.modelKind : request.mesh.kind,
    audioBrief: request.sound
      ? shortText(plan.audio, 300)
        || shortText(`Cinematic soundtrack for: ${request.style || plan.style || request.prompt}`, 300)
      : '',
    scenes,
  }
}

/** System prompt of the planning call. */
const PLAN_SYSTEM = [
  'You are the director of an in-browser generative film studio.',
  'You plan short procedural films that a browser renders in real time: 2D Canvas2D animation, 3D WebGL fragment shaders (ray marching), and 3D "mesh" scenes that animate a 3D model the user uploaded.',
  'There are no external assets: no images, no textures, no sounds, no fonts, no network. Everything is drawn procedurally from code, except the uploaded model.',
  '',
  'Answer with ONE JSON object and nothing else. No prose, no markdown fences.',
  'Exact shape:',
  '{',
  '  "title": "short film title, at most 60 characters",',
  '  "summary": "one sentence describing what the viewer sees, at most 200 characters",',
  '  "style": "visual style keywords, at most 80 characters",',
  '  "modelKind": "humanoid" | "creature" | "vehicle" | "object" | "architecture" | "other",',
  '  "audio": "one sentence describing the soundtrack, or omit for silence",',
  '  "scenes": [',
  '    {',
  '      "name": "short scene name, at most 40 characters",',
  '      "engine": "2d" or "3d" or "mesh",',
  '      "durationSec": 2.5,',
  '      "brief": "visual and motion description the programmer can implement, at most 350 characters"',
  '    }',
  '  ]',
  '}',
  '',
  'Rules:',
  '- 2 or 3 scenes (up to 4 for films longer than 30 seconds); their durationSec values must add up to the requested total duration (the request may ask for up to 60 seconds, so single scenes can be long).',
  '- Respect the requested mode: "2d" means every scene uses engine "2d"; "3d" means every scene uses "3d" or "mesh"; "mixed" lets you mix all three.',
  '- The request may include a geometry analysis of the uploaded model: a likely kind, symmetry, extents and an 8-part segmentation. Trust it, refine the classification in "modelKind", and plan shots that show the model\'s characteristic features. When the analysis says humanoid/creature, plan shots where limbs and posture move; for vehicle, plan mechanical motion; for object, hero rotation/assembly; for architecture, light and part motion.',
  '- When the request describes the user\'s uploaded 3D model, use engine "mesh" for the shots that show it, and "3d" shader scenes for its environment, transitions or abstract inserts. Prefer 2 or 3 mesh shots that reveal, orbit and articulate the model rather than one static shot.',
  '- 2D scenes are Canvas2D drawing: gradients, shapes, particles, glow, procedural noise, motion.',
  '- 3D scenes are one procedural fragment shader with ray marching, lighting, fog and a moving camera.',
  '- Mesh scenes animate the uploaded model with a camera move, light and material controls plus per-part limb motion; describe the intended motion, camera and mood precisely.',
  '- If the request asks for sound, fill "audio" with a concise cinematic sound-design brief that matches the film (ambience, accents, texture). Never plan speech or copyrighted music.',
  '- The film needs visual continuity and an arc: establish, develop, resolve. Choose deliberate color palettes and camera motion.',
  '- Aim for physical realism: plausible lighting, materials, atmosphere, depth of field and camera behavior. Avoid flat cartoon colors and toy-like looks unless the request asks for them.',
  '- Prefer bold, cinematic, high-contrast imagery over text. Never plan a scene that depends on readable text.',
  '- Scenes must render at 30 fps in a browser: no per-pixel JavaScript loops and no huge particle counts.',
].join('\n')

/** System prompt of a 2D scene code call. */
const SCENE_2D_SYSTEM = [
  'You are a senior creative programmer. Write a self-contained Canvas2D renderer for one scene of a procedural short film.',
  'Return ONLY JavaScript source code. No markdown fences, no prose before or after the code, no explanation of your answer.',
  '',
  'Return shape — write this complete function declaration, with your animation inside it:',
  '  function draw(ctx, W, H, t, duration) { /* your code */ }',
  'The renderer calls it once per frame; a body-only answer without the declaration is also accepted.',
  '',
  'Environment:',
  '- ctx: CanvasRenderingContext2D for a W x H canvas that is cleared to near-black before each frame.',
  '- W, H: canvas size in pixels.',
  '- t: seconds since this scene started (0 .. duration). duration: this scene length in seconds.',
  '- The sandbox has no DOM, no window, no fetch, no imports, no timers. requestAnimationFrame and setTimeout do not exist.',
  '',
  'Hard rules:',
  '- Draw a full-frame background first (fillRect with a gradient or solid color).',
  '- Be deterministic: do not use Math.random(). Derive pseudo-random values from a small seeded hash function of fixed inputs.',
  '- The same t must always produce the same frame.',
  '- Save and restore canvas state you modify. Reset globalAlpha, shadowBlur and transforms you set.',
  '- No external images, fonts or network. Geometric shapes only; avoid text.',
  '- Modern JavaScript (ES2020), no syntax errors, no TypeScript, no imports.',
  '',
  'Quality bar:',
  '- Cinematic composition: layered gradients, glow (shadowBlur), particles, geometric motion, smooth easing, vignette, grain.',
  '- Motion must feel designed: easing functions, camera-like drift, parallax layers.',
  '- Performance: per-frame work linear in a few thousand operations. Never loop over every pixel.',
  '- Prefer a few small helper functions (drawParticles, drawRings, ...) so the body stays readable.',
  '- Use anti-aliased strokes, layered translucency and additive bloom-like glow for a photographic look, plus subtle grain and vignette.',
].join('\n')

/** System prompt of a 3D scene code call. */
const SCENE_3D_SYSTEM = [
  'You are a senior shader programmer. Write ONE WebGL1 fragment shader for a procedural 3D scene.',
  'Return ONLY GLSL source code. No markdown fences, no prose, no explanation.',
  '',
  'These declarations already exist BEFORE your code; do not repeat them:',
  '  precision highp float;',
  '  uniform vec2 u_resolution;',
  '  uniform float u_time;',
  '  uniform float u_duration;',
  '',
  'Your code defines helper functions and exactly one entry point:',
  '  void main() { ... gl_FragColor = vec4(color, 1.0); }',
  '',
  'Rules:',
  '- GLSL ES 1.00 / WebGL1. No textures, no samplers, no derivatives (fwidth), no extensions, no version pragma.',
  '- Loops must use constant bounds, at most 96 iterations.',
  '- Rendering must be deterministic: only u_time animates the scene.',
  '- Build camera rays from gl_FragCoord.xy and u_resolution; use a real camera (position, target, fov) and at least one light source.',
  '- Recommended: signed distance fields with sphere tracing, soft shadows, fog/atmospheric perspective, slow cinematic camera motion.',
  '- Animate the scene itself, not only the camera, so the image stays interesting for the whole duration.',
  '- Aim for a cinematic palette, depth and glow. Avoid a single flat color.',
  '',
  'Quality bar:',
  '- A compiling shader is mandatory. Keep the code conservative and idiomatic WebGL1.',
  '- Prefer well-known SDF primitives (sphere, round box, torus, plane) and composition operators.',
  '- Apply filmic/ACES-like tone mapping and gamma correction to the final color, and anti-alias edges with smoothstep instead of hard steps.',
  '- Shade like real materials: a key light with falloff, ambient bounce, fresnel rim and atmospheric depth.',
].join('\n')

/** System prompt of a 3D mesh scene animation call. */
const SCENE_MESH_SYSTEM = [
  'You are a technical animator. The user uploaded a real 3D model; write a short JavaScript animation for one scene that shows it.',
  'Return ONLY JavaScript source code. No markdown fences, no prose, no explanation.',
  '',
  'Return shape — one function that maps scene time to animation controls:',
  '  function animate(t, duration) {',
  '    return { rotY: 0.6, camRadius: 3.4, camAngle: 0.4, camHeight: 1.1, lightPower: 1.2 };',
  '  }',
  'The renderer calls it once per frame and applies the returned controls.',
  '',
  'Available controls (all optional numbers; the renderer clamps them):',
  '- rotX, rotY, rotZ: model rotation in radians (spin the model).',
  '- scale: model scale, 0.2 .. 4 (1 is framed to the viewport).',
  '- offsetY: vertical offset in model units, -1 .. 1.',
  '- camRadius: camera distance, 1.6 .. 12.',
  '- camAngle: camera azimuth in radians (orbit the model).',
  '- camHeight: camera height, -2 .. 4.',
  '- camFov: camera field of view, 0.5 .. 1.6.',
  '- targetY: look-at height offset, -1 .. 1.',
  '- lightAz, lightEl: key light azimuth/elevation in radians.',
  '- lightPower: key light intensity, 0.5 .. 3.',
  '- roughness: material roughness, 0.05 .. 1.',
  '- metalness: material metalness, 0 .. 1.',
  '- tint: optional base color as [r, g, b] with channels 0 .. 1. Use it to describe the model material (stone, metal, skin, cloth).',
  '- rim: rim-light strength, 0 .. 1.',
  '- fog: atmospheric fog amount, 0 .. 1.',
  '- explode: pieces separate along their normals, 0 .. 0.25.',
  '- wobble: organic surface wobble, 0 .. 0.03.',
  '- growth: model grows into place from 0 .. 1 (use as a reveal).',
  '- parts: array of per-limb animations, at most 8 entries: { i: part index 0..7, rx, ry, rz: rotation in radians around that part\'s center, ox, oy, oz: offset in model units, -1 .. 1 }.',
  '',
  'Hard rules:',
  '- Pure and deterministic: depend only on t and duration. No Math.random(), no Date, no DOM, no network, no timers, no imports.',
  '- Return a plain object; never return undefined or a function.',
  '- The model is split into 8 rigid parts and the scene message lists their table: center, size, share, mirror partner and limb score. Animate limbs by rotating their parts around their centers through the "parts" array.',
  '- Match the analysed kind: humanoid → posture, arm and leg swings, head nod, weight shift; creature → gait, tail sway, wing flaps; vehicle → wheel/turret mechanical rotation; object → hero spin, part assembly; architecture → light sweeps, doors and panels.',
  '- Use mirrored parts in opposition for natural walking: when one side rotates forward, its mirror rotates backward.',
  '- Keep the root transform for global framing (position, overall turn, camera) and leave the "parts" array for articulation. Do not detach parts with offsets larger than 1 unless the brief asks for an explosion.',
  '- Use smooth easing (smoothstep-style, sin, pow) so motion feels designed rather than linear.',
  '- Animate the model itself — limbs, root, camera and light — a static pose with an orbiting camera is not enough.',
  '',
  'Quality bar:',
  '- Plan a small arc across the scene: reveal, hero angle, articulated action, settle.',
  '- Use explode/growth only when the brief asks for assembly, scanning or destruction; otherwise keep the model intact and light it beautifully.',
  '- Lighting and material values should make the model look real: a clear key light, moderate roughness, subtle rim.',
  '- Match the material to the subject: metal is metalness ~0.8-1 with roughness ~0.2-0.4; stone is metalness 0 with roughness ~0.7; choose tint accordingly.',
  '- The renderer already applies physically based shading, gamma correction, contact shadow, fog and film grain; your job is the motion, framing, light and material.',
].join('\n')

/** System prompt of a soundtrack code call (Web Audio offline render). */
const AUDIO_SYSTEM = [
  'You are a sound designer and Web Audio programmer writing the soundtrack for a short film.',
  'Return ONLY JavaScript source code. No markdown fences, no prose, no explanation.',
  '',
  'The code is the body of this function:',
  '  function soundtrack(ctx, duration) { /* your code */ }',
  '',
  'Environment:',
  '- ctx: an OfflineAudioContext with 2 channels at 44100 Hz.',
  '- duration: the film length in seconds.',
  '- The sandbox has no DOM, no fetch, no imports, no timers, no console.',
  '',
  'Rules:',
  '- Build the whole score offline: create oscillators, noise buffers, biquad filters, gains, stereo panners and delays; schedule every event with absolute times (ctx.currentTime + seconds); connect the final mix to ctx.destination.',
  '- Cover the full duration with a bed (ambience or drone), then add accents and movement that follow the film arc. Leave no silent gaps unless the brief asks for one.',
  '- Be deterministic: no Math.random(); use a seeded hash to fill a noise buffer.',
  '- Keep the peak below 0.7 using a master gain; avoid clipping and DC offset; fade in over about 0.2 s and fade out over the last 0.5 s.',
  '- No voice, no speech, no recognisable copyrighted melodies. Synthetic, cinematic sound design only.',
  '- Modern JavaScript (ES2020), no syntax errors, no TypeScript.',
  '',
  'Quality bar:',
  '- A rich ambient bed, filtered noise texture and a few tonal elements (pad, bass, bell accents).',
  '- Use envelopes (gains) on every accent so notes do not click.',
  '- Match the film mood from the brief: tense, serene, epic, mechanical, organic.',
].join('\n')

/** System prompt of a dialogue/voice-over call. */
const DIALOG_SYSTEM = [
  'You write spoken lines for a short film made by an in-browser studio.',
  'The film already has scenes and a soundtrack. Add short dialogue or voice-over lines that fit the action.',
  '',
  'Answer with ONE JSON object and nothing else. No prose, no markdown fences.',
  '{',
  '  "lines": [',
  '    { "at": 1.2, "duration": 2.4, "text": "spoken line", "voice": "male" }',
  '  ]',
  '}',
  '',
  'Rules:',
  '- 0 to 5 lines. Use fewer when the film has no characters or is abstract; a single narrator line is fine.',
  '- "at" is the absolute time in seconds from the film start; "duration" is how long the line takes (0.8 to 8 seconds). A line must end inside the film.',
  '- "text" is what the character says, at most 160 characters, in the user\'s language. No stage directions, no quotation marks, no speaker labels.',
  '- "voice" is one of "male", "female", "child", "robot", "narrator". Match the character and scene.',
  '- Lines may be sequential or overlapping only when two characters speak at once; keep speech sparse so music and effects breathe.',
  '- Never write lyrics, copyrighted text, or instructions to the viewer.',
].join('\n')

/** System prompt of a whole-film revision plan call. */
const REFINE_SYSTEM = [
  'You are revising an existing short film in an in-browser generative studio. The user gives one refinement instruction.',
  'Keep everything the instruction does not ask to change. Never rewrite working scenes for no reason.',
  '',
  'Answer with ONE JSON object and nothing else. No prose, no markdown fences.',
  'Exact shape:',
  '{',
  '  "reply": "one sentence to the user about what you changed",',
  '  "title": "optional new title",',
  '  "summary": "optional new one-sentence summary",',
  '  "modelKind": "optional updated classification of the uploaded model",',
  '  "audio": "optional new sound-design brief; omit it to keep the current soundtrack",',
  '  "scenes": [',
  '    { "source": 0, "keep": true },',
  '    { "source": 1, "keep": false, "name": "scene name", "engine": "2d", "durationSec": 2.6, "brief": "what this scene must show now" },',
  '    { "source": null, "keep": false, "name": "new scene", "engine": "3d", "durationSec": 2, "brief": "a new scene to insert" }',
  '  ]',
  '}',
  '',
  'Rules:',
  '- "scenes" is the COMPLETE new scene list, in playing order. The order of entries is the order of the film.',
  '- "source" is the index of the existing scene this entry is based on, or null for a brand-new scene.',
  '- "keep": true means keep that existing scene exactly as it is (no regeneration). Use it for every scene the instruction does not touch.',
  '- "keep": false with a source means regenerate that scene from the brief, using its current code as the starting point.',
  '- You may add scenes (source null) and remove scenes (omit them from the list). 1 to 6 scenes total.',
  '- Preserve the film\'s visual continuity unless the instruction asks to change the look.',
  '- "engine" must be one of "2d", "3d", "mesh". Use "mesh" only when an uploaded 3D model is available; "3d" means a procedural shader scene.',
  '- Keep the total duration close to the current duration unless the instruction asks for a longer or shorter film. The film may be up to 60 seconds long.',
  '- Use "audio" only when the instruction asks about sound or music; omit it so the existing soundtrack survives unchanged.',
  '- Update "modelKind" only when the instruction reveals a better classification of the uploaded model.',
  '- Put the actual change in the briefs: name the objects, colors, motion, camera and mood precisely so the scene programmer can implement it.',
  '- The reply must be short, concrete and in the user\'s language.',
].join('\n')

/**
 * Strip fences from a model code answer.
 * @param {string} text - raw model output.
 * @returns {string} the code only.
 */
function stripFences(text) {
  const blocks = [...text.matchAll(/```[A-Za-z0-9_+#.-]*[ \t]*\r?\n([\s\S]*?)```/g)].map(match => match[1])
  const source = blocks.length > 0 ? blocks.join('\n\n') : text
  return source.replace(/^\uFEFF/, '').trim()
}

/**
 * Describe a model's segmentation to the scene code call, so the model can
 * articulate limbs instead of only moving the whole object.
 * @param {any} mesh - accepted mesh summary.
 * @returns {string[]} prompt lines.
 */
function meshPartLines(mesh) {
  if (mesh === undefined || !Array.isArray(mesh.parts) || mesh.parts.length === 0) return []
  const lines = []
  if (mesh.analysis !== undefined) {
    lines.push(`Model analysis: kind=${mesh.kind}; symmetry=${mesh.analysis.symmetry}; extents=${mesh.analysis.extents.map(value => value.toFixed(2)).join(' x ')}; limb parts=${mesh.analysis.limbParts}`)
  } else {
    lines.push(`Model analysis: kind=${mesh.kind}`)
  }
  lines.push('Part table (index | center x,y,z | size x,y,z | share | limb score | mirror part):')
  for (const part of mesh.parts) {
    lines.push(`${part.index} | ${part.center.map(value => value.toFixed(2)).join(',')} | ${part.size.map(value => value.toFixed(2)).join(',')} | ${Math.round(part.share * 100)}% | ${part.limb.toFixed(2)} | ${part.mirror >= 0 ? part.mirror : '-'}`)
  }
  return lines
}

/**
 * Render one scene's system/user pair for the current engine.
 * @param {string} engine - '2d', '3d' or 'mesh'.
 * @param {{ title: string, summary: string, style: string, scenes: Array<any> }} plan - accepted plan.
 * @param {number} index - scene index in the plan.
 * @param {ReturnType<typeof normalizeRequest>} request - validated request.
 * @param {string} note - extra instruction appended for a repair attempt.
 * @param {string} previousCode - current implementation of a revised scene.
 * @returns {{ system: string, user: string }} the code call.
 */
function sceneCall(engine, plan, index, request, note = '', previousCode = '') {
  const scene = plan.scenes[index]
  const otherScenes = plan.scenes
    .map((row, at) => `${at + 1}. ${row.name} (${row.engine}, ${row.durationSec}s): ${row.brief}`)
    .join('\n')
  const meshLine = request.mesh === undefined
    ? ''
    : `Uploaded 3D model: "${request.mesh.name}" (${request.mesh.triangles} triangles). The built-in mesh renderer lights it with physically based shading; animate it through the controls.`
  const meshDetails = engine === 'mesh' ? meshPartLines(request.mesh) : []
  const system = engine === '3d'
    ? SCENE_3D_SYSTEM
    : engine === 'mesh' ? SCENE_MESH_SYSTEM : SCENE_2D_SYSTEM
  const closing = engine === '3d'
    ? `Write the fragment shader for scene ${index + 1} only.`
    : engine === 'mesh'
      ? `Write the complete animate() function for scene ${index + 1} only.`
      : `Write the complete draw() function for scene ${index + 1} only.`
  const previous = previousCode === ''
    ? []
    : [
      '',
      'Current implementation of this scene — revise it, keep the working parts, apply the requested change:',
      '```',
      previousCode,
      '```',
      '',
      `Return the complete updated ${engine === '3d' ? 'fragment shader' : engine === 'mesh' ? 'animate() function' : 'draw() function'}.`,
    ]
  const user = [
    `Film title: ${plan.title}`,
    `Summary: ${plan.summary}`,
    plan.style === '' ? '' : `Visual style: ${plan.style}`,
    `Requested mode: ${request.mode}`,
    plan.revision === undefined ? '' : `Revision instruction: ${plan.revision}`,
    '',
    `Scene ${index + 1} of ${plan.scenes.length}: ${scene.name}`,
    `Engine: ${engine}`,
    `Duration: ${scene.durationSec} seconds`,
    `Brief: ${scene.brief}`,
    `Resolution: ${request.width}x${request.height} at ${request.fps} frames per second`,
    meshLine,
    ...meshDetails,
    '',
    'Full scene list for continuity:',
    otherScenes,
    ...previous,
    '',
    closing,
    note,
  ].filter(line => line !== '').join('\n')
  return { system, user }
}

/**
 * Ask for one scene's code and repair one obviously unusable answer.
 * @param {{ llm: any, provider: string, model: string }} route - resolved model route.
 * @param {string} engine - '2d', '3d' or 'mesh'.
 * @param {any} plan - accepted plan.
 * @param {number} index - scene index.
 * @param {ReturnType<typeof normalizeRequest>} request - validated request.
 * @param {AbortSignal} signal - cancellation.
 * @param {string} [previousCode] - current implementation of a revised scene.
 * @returns {Promise<string>} the scene source code.
 */
async function generateSceneCode(route, engine, plan, index, request, signal, previousCode = '') {
  let note = ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const call = sceneCall(engine, plan, index, request, note, previousCode)
    const text = await collectText(route, {
      system: call.system,
      user: call.user,
      maxTokens: CODE_MAX_TOKENS,
      temperature: attempt === 0 ? 0.45 : 0.2,
    }, signal)
    const code = stripFences(text)
    if (code.length < 20) {
      note = 'Your previous answer was empty or too short. Return the complete code.'
      continue
    }
    if (engine === '3d') {
      const hasEntry = /void\s+main\s*\(/.test(code) || /mainImage\s*\(/.test(code)
      if (!hasEntry) {
        note = 'Your previous answer had no entry point. Return a complete GLSL shader with exactly one void main() that writes gl_FragColor.'
        continue
      }
    }
    if (engine === 'mesh' && !/animate\s*\(/.test(code) && !/return\s*\{/.test(code)) {
      note = 'Your previous answer defined no animate() function. Return the complete function animate(t, duration) { return { ... } }.'
      continue
    }
    if (engine === '2d' || engine === 'mesh') {
      try {
        const parameters = engine === '2d' ? ['ctx', 'W', 'H', 't', 'duration'] : ['t', 'duration']
        new Function(...parameters, code)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        note = `Your previous answer had a JavaScript syntax error (${reason}). Return the complete corrected code.`
        continue
      }
    }
    return code
  }
  throw new StudioError(
    'CODE_INVALID',
    `The model did not produce usable code for scene ${index + 1} ("${plan.scenes[index].name}"). Try again.`,
    502,
  )
}

/**
 * Run one operation under the plugin's generation deadline and the caller's
 * cancellation, mapping both to the studio's own failures.
 * @param {{ timeoutMs: number }} settings - timeout policy.
 * @param {AbortSignal | undefined} outerSignal - browser disconnect or tool cancellation.
 * @param {(signal: AbortSignal) => Promise<any>} work - operation to run.
 * @returns {Promise<any>} the operation result.
 */
async function withDeadline(settings, outerSignal, work) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    const timeout = new StudioError('TIMEOUT', 'The model took too long to answer. Try a shorter film or a smaller change.', 504)
    timeout.name = 'StudioTimeout'
    controller.abort(timeout)
  }, settings.timeoutMs)
  const forward = () => controller.abort(outerSignal?.reason)
  if (outerSignal !== undefined) {
    if (outerSignal.aborted) forward()
    else outerSignal.addEventListener('abort', forward, { once: true })
  }
  try {
    return await work(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw abortReason(controller.signal)
    throw error
  } finally {
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', forward)
  }
}

/**
 * Validate the project a refinement request sends back, so a stale or hand-edited
 * client cannot hand the model a malformed scene list.
 * @param {unknown} raw - project payload.
 * @param {{ mesh?: { name: string, triangles: number } }} context - mesh availability.
 * @returns {{ id: string, title: string, summary: string, style: string, engine: string, width: number, height: number, fps: number, scenes: Array<any> }} the accepted project.
 */
function normalizeProject(raw, context) {
  const project = raw !== null && typeof raw === 'object' ? raw : {}
  const rawScenes = Array.isArray(project.scenes) ? project.scenes : []
  const scenes = []
  for (const item of rawScenes.slice(0, MAX_REFINE_SCENES)) {
    if (item === null || typeof item !== 'object') continue
    let engine = ENGINES.includes(item.engine) ? item.engine : '2d'
    if (engine === 'mesh' && context.mesh === undefined) engine = '3d'
    const code = typeof item.code === 'string' ? item.code : ''
    if (code.trim() === '') continue
    scenes.push({
      name: shortText(item.name, 40) || `Scene ${scenes.length + 1}`,
      engine,
      durationSec: Math.round(clampNumber(item.durationSec, 1, MAX_SCENE_DURATION, 3) * 10) / 10,
      brief: shortText(item.brief, 400),
      code,
    })
  }
  if (scenes.length === 0) {
    throw new StudioError('INVALID_PROJECT', 'The film has no rendered scenes to revise. Generate one first.', 400)
  }
  const audio = project.audio !== null && typeof project.audio === 'object' && typeof project.audio.code === 'string' && project.audio.code.trim() !== ''
    ? { code: project.audio.code, brief: shortText(project.audio.brief, 300) }
    : undefined
  const totalDuration = Math.round(scenes.reduce((sum, scene) => sum + scene.durationSec, 0) * 10) / 10
  return {
    id: shortText(project.id, 80) || globalThis.crypto.randomUUID(),
    title: shortText(project.title, 80) || 'Untitled film',
    summary: shortText(project.summary, 300),
    style: shortText(project.style, 120),
    engine: MODES.includes(project.engine) ? project.engine : 'mixed',
    modelKind: MODEL_KINDS.includes(project.modelKind) ? project.modelKind : undefined,
    width: Math.round(clampNumber(project.width, 320, 1920, 1280) / 2) * 2,
    height: Math.round(clampNumber(project.height, 240, 1080, 720) / 2) * 2,
    fps: Number(project.fps) === 24 ? 24 : 30,
    audioBrief: shortText(project.audioBrief, 300),
    dialog: normalizeDialog(project.dialog, totalDuration),
    ...(audio === undefined ? {} : { audio }),
    scenes,
  }
}

/**
 * Validate a refinement request.
 * @param {unknown} input - request body or tool arguments.
 * @returns {{ instruction: string, mesh?: any, project: any }} accepted request.
 */
function normalizeRefineRequest(input) {
  const raw = input !== null && typeof input === 'object' ? input : {}
  const instruction = typeof raw.instruction === 'string' ? raw.instruction.trim() : ''
  if (instruction.length < 2) {
    throw new StudioError('INVALID_INSTRUCTION', 'Write what to change (at least 2 characters).', 400)
  }
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    throw new StudioError('INVALID_INSTRUCTION', `The instruction is limited to ${MAX_INSTRUCTION_CHARS} characters.`, 400)
  }
  const mesh = normalizeMeshInfo(raw.mesh)
  return {
    instruction,
    sound: raw.sound !== false,
    ...(mesh === undefined ? {} : { mesh }),
    project: normalizeProject(raw.project, mesh === undefined ? {} : { mesh }),
  }
}

/**
 * Normalize the model's revision plan against the current project.
 * @param {unknown} parsed - the model's JSON plan.
 * @param {any} project - accepted current project.
 * @param {any} request - request-shaped prompt context (mesh availability, dimensions).
 * @returns {{ reply: string, title: string, summary: string, scenes: Array<any> }} the accepted revision.
 */
function normalizeRefinePlan(parsed, project, request) {
  const plan = parsed !== null && typeof parsed === 'object' ? parsed : {}
  const rawScenes = Array.isArray(plan.scenes) ? plan.scenes : []
  const entries = []
  for (const item of rawScenes.slice(0, MAX_REFINE_SCENES)) {
    if (item === null || typeof item !== 'object') continue
    const source = Number.isInteger(item.source) && item.source >= 0 && item.source < project.scenes.length
      ? item.source
      : null
    const existing = source === null ? undefined : project.scenes[source]
    const keep = item.keep === true && existing !== undefined
    if (keep) {
      entries.push({
        keep: true,
        source,
        name: existing.name,
        engine: existing.engine,
        durationSec: existing.durationSec,
        brief: existing.brief,
        code: existing.code,
      })
      continue
    }
    let engine = ENGINES.includes(item.engine)
      ? item.engine
      : existing !== undefined ? existing.engine : '2d'
    if (engine === 'mesh' && request.mesh === undefined) engine = '3d'
    entries.push({
      keep: false,
      source,
      name: shortText(item.name, 40) || existing?.name || `Scene ${entries.length + 1}`,
      engine,
      durationSec: Math.round(clampNumber(item.durationSec, 1, MAX_SCENE_DURATION, existing?.durationSec ?? 3) * 10) / 10,
      brief: shortText(item.brief, 400) || existing?.brief || shortText(project.summary, 300),
      code: '',
    })
  }
  if (entries.length === 0) {
    throw new StudioError('REFINE_EMPTY', 'The model returned no scenes for this revision. Try rephrasing the change.', 502)
  }
  const total = entries.reduce((sum, entry) => sum + entry.durationSec, 0)
  if (total > 90) {
    const scale = 90 / total
    for (const entry of entries) entry.durationSec = Math.round(entry.durationSec * scale * 10) / 10
  }
  return {
    reply: shortText(plan.reply, 400) || 'Applied the requested change.',
    title: shortText(plan.title, 80) || project.title,
    summary: shortText(plan.summary, 300) || project.summary,
    modelKind: MODEL_KINDS.includes(plan.modelKind) ? plan.modelKind : undefined,
    audioBrief: shortText(plan.audio, 300),
    scenes: entries,
  }
}

/**
 * Ask for the soundtrack code that the renderer builds offline.
 * @param {{ llm: any, provider: string, model: string }} route - resolved model route.
 * @param {{ title: string, summary: string, style: string, audioBrief: string }} plan - accepted plan.
 * @param {ReturnType<typeof normalizeRequest>} request - validated request.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<string>} the soundtrack source code.
 */
async function generateAudioCode(route, plan, request, signal) {
  let note = ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await collectText(route, {
      system: AUDIO_SYSTEM,
      user: [
        `Film title: ${plan.title}`,
        `Summary: ${plan.summary}`,
        plan.style === '' ? '' : `Visual style: ${plan.style}`,
        `Duration: ${request.durationSec} seconds`,
        `Sound design brief: ${plan.audioBrief}`,
        '',
        'Return only the complete function soundtrack(ctx, duration) code.',
        note,
      ].filter(line => line !== '').join('\n'),
      maxTokens: AUDIO_MAX_TOKENS,
      temperature: attempt === 0 ? 0.55 : 0.2,
    }, signal)
    const code = stripFences(text)
    if (code.length < 30 || !/soundtrack\s*\(/.test(code)) {
      note = 'Your previous answer was empty or had no soundtrack() function. Return the complete function.'
      continue
    }
    try {
      new Function('ctx', 'duration', code)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      note = `Your previous answer had a JavaScript syntax error (${reason}). Return the complete corrected soundtrack function.`
      continue
    }
    return code
  }
  throw new StudioError('AUDIO_CODE_INVALID', 'The model did not produce a usable soundtrack.', 502)
}

const VOICES = ['male', 'female', 'child', 'robot', 'narrator']

/**
 * Normalize a dialogue plan against the film length.
 * @param {unknown} parsed - the model's JSON.
 * @param {number} totalDuration - film length in seconds.
 * @returns {Array<{ at: number, duration: number, text: string, voice: string }>} accepted lines.
 */
function normalizeDialog(parsed, totalDuration) {
  const plan = parsed !== null && typeof parsed === 'object' ? parsed : {}
  const rawLines = Array.isArray(plan.lines) ? plan.lines : []
  const lines = []
  for (const item of rawLines.slice(0, 5)) {
    if (item === null || typeof item !== 'object') continue
    const text = shortText(item.text, 160)
    if (text.length < 2) continue
    const duration = Math.round(clampNumber(item.duration, 0.8, 8, 2.5) * 10) / 10
    const at = Math.round(clampNumber(item.at, 0, Math.max(0, totalDuration - 0.5), 0) * 10) / 10
    if (at + duration > totalDuration + 0.5) continue
    lines.push({
      at,
      duration,
      text,
      voice: VOICES.includes(item.voice) ? item.voice : 'narrator',
    })
  }
  return lines.sort((left, right) => left.at - right.at)
}

/**
 * Ask for the spoken lines of the film.
 * @param {{ llm: any, provider: string, model: string }} route - resolved model route.
 * @param {any} plan - accepted plan.
 * @param {ReturnType<typeof normalizeRequest>} request - validated request.
 * @param {number} totalDuration - film length in seconds.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<Array<any>>} accepted dialogue lines (possibly empty).
 */
async function generateDialog(route, plan, request, totalDuration, signal) {
  const sceneLines = plan.scenes
    .map((scene, index) => `${index + 1}. ${scene.name} (${scene.engine}, ${scene.durationSec}s): ${scene.brief}`)
    .join('\n')
  const text = await collectText(route, {
    system: DIALOG_SYSTEM,
    user: [
      `Film title: ${plan.title}`,
      `Summary: ${plan.summary}`,
      plan.style === '' ? '' : `Style: ${plan.style}`,
      `Total duration: ${totalDuration} seconds`,
      `User request: ${request.prompt}`,
      '',
      'Scenes:',
      sceneLines,
      '',
      'Return the JSON dialogue plan only.',
    ].filter(line => line !== '').join('\n'),
    maxTokens: 1200,
    temperature: 0.7,
  }, signal)
  return normalizeDialog(parsePlanJson(text), totalDuration)
}

/**
 * Build the service shared by the Fetch routes and the agent tools.
 * @param {any} ctx - Host plugin context.
 * @param {{ provider?: string, model?: string, timeoutMs: number }} settings - resolved config.
 * @returns {{ generate: Function, refine: Function, info: Function }} the studio service.
 */
function createStudio(ctx, settings) {
  /**
   * Plan the film and write every scene's renderer.
   * @param {unknown} raw - request body or tool arguments.
   * @param {AbortSignal} outerSignal - browser disconnect or tool cancellation.
   * @returns {Promise<any>} the renderable project.
   */
  async function generate(raw, outerSignal) {
    const request = normalizeRequest(raw)
    const route = await resolveRoute(ctx, settings)
    return withDeadline(settings, outerSignal, async (signal) => {
      try {
        const planText = await collectText(route, {
          system: PLAN_SYSTEM,
          user: [
            `Video request: ${request.prompt}`,
            `Mode: ${request.mode}`,
            `Total duration: ${request.durationSec} seconds`,
            `Resolution: ${request.width}x${request.height} at ${request.fps} fps`,
            request.style === '' ? '' : `Style: ${request.style}`,
            request.mesh === undefined ? '' : `Uploaded 3D model: "${request.mesh.name}" (${request.mesh.triangles} triangles). Geometry analysis: likely kind=${request.mesh.kind}; symmetry=${request.mesh.analysis?.symmetry ?? '?'}; extents=${(request.mesh.analysis?.extents ?? []).join(' x ')}; limb-like parts=${request.mesh.analysis?.limbParts ?? '?'}. The model is segmented into ${request.mesh.parts.length} animatable parts.`,
            request.sound ? 'Sound: requested — fill the plan "audio" field with a sound-design brief.' : 'Sound: not requested — omit "audio".',
            request.continuation === '' ? '' : `This shot continues a film already in progress. Previous shots:\n${request.continuation}`,
            '',
            'Return the JSON plan only.',
          ].filter(line => line !== '').join('\n'),
          maxTokens: PLAN_MAX_TOKENS,
          temperature: 0.7,
        }, signal)
        const plan = normalizePlan(parsePlanJson(planText), request)
        const scenes = []
        for (let index = 0; index < plan.scenes.length; index += 1) {
          signal.throwIfAborted()
          const scene = plan.scenes[index]
          const code = await generateSceneCode(route, scene.engine, plan, index, request, signal)
          scenes.push({ name: scene.name, engine: scene.engine, durationSec: scene.durationSec, brief: scene.brief, code })
        }
        let audioCode = ''
        let audioError = ''
        if (request.sound && plan.audioBrief !== '') {
          try {
            audioCode = await generateAudioCode(route, plan, request, signal)
          } catch (error) {
            audioError = error instanceof Error ? error.message : String(error)
          }
        }
        const totalActual = Math.round(scenes.reduce((sum, scene) => sum + scene.durationSec, 0) * 10) / 10
        let dialog = []
        if (request.sound) {
          try {
            dialog = await generateDialog(route, plan, request, totalActual, signal)
          } catch {
            dialog = []
          }
        }
        return {
          id: globalThis.crypto.randomUUID(),
          title: plan.title,
          summary: plan.summary,
          style: plan.style,
          engine: request.mode,
          width: request.width,
          height: request.height,
          fps: request.fps,
          scenes,
          modelKind: plan.modelKind,
          audioBrief: plan.audioBrief,
          dialog,
          ...(audioCode === '' ? {} : { audio: { code: audioCode, brief: plan.audioBrief } }),
          ...(audioError === '' ? {} : { audioError }),
          provider: route.provider,
          model: route.model,
          createdAt: new Date().toISOString(),
        }
      } catch (error) {
        if (error instanceof StudioError) throw error
        const reason = error instanceof Error ? error.message : String(error)
        throw new StudioError('GENERATION_FAILED', `Film generation failed: ${reason}`, 500)
      }
    })
  }

  /**
   * Revise the active film from one natural-language instruction. Scenes the
   * instruction does not touch are copied verbatim; changed and new scenes are
   * regenerated from their current code.
   * @param {unknown} raw - request body or tool arguments.
   * @param {AbortSignal} outerSignal - browser disconnect or tool cancellation.
   * @returns {Promise<{ project: any, reply: string }>} the revised film.
   */
  async function refine(raw, outerSignal) {
    const input = normalizeRefineRequest(raw)
    const route = await resolveRoute(ctx, settings)
    const project = input.project
    const request = {
      prompt: project.title,
      mode: project.engine,
      durationSec: Math.round(project.scenes.reduce((sum, scene) => sum + scene.durationSec, 0) * 10) / 10,
      fps: project.fps,
      width: project.width,
      height: project.height,
      style: project.style,
      revision: input.instruction,
      sound: input.sound,
      ...(input.mesh === undefined ? {} : { mesh: input.mesh }),
    }
    return withDeadline(settings, outerSignal, async (signal) => {
      try {
        const sceneLines = project.scenes
          .map((scene, index) => `${index + 1}. ${scene.name} (${scene.engine}, ${scene.durationSec} s, ${scene.code.length} code chars): ${scene.brief}`)
          .join('\n')
        const planText = await collectText(route, {
          system: REFINE_SYSTEM,
          user: [
            `Film title: ${project.title}`,
            `Summary: ${project.summary}`,
            project.style === '' ? '' : `Visual style: ${project.style}`,
            `Total duration: ${request.durationSec} seconds at ${request.width}x${request.height}, ${request.fps} fps`,
            request.mesh === undefined ? '' : `Uploaded 3D model: "${request.mesh.name}" (${request.mesh.triangles} triangles); kind=${request.mesh.kind}; limb parts=${request.mesh.analysis?.limbParts ?? '?'}; engine "mesh" is available.`,
            project.audioBrief === undefined || project.audioBrief === '' ? 'Sound: none.' : `Current sound design: ${project.audioBrief}`,
            request.sound ? 'Sound: enabled — return "audio" only if the instruction asks to change it.' : 'Sound: disabled — the instruction asks to remove sound.',
            '',
            'Current scenes:',
            sceneLines,
            '',
            `User refinement instruction: ${input.instruction}`,
            '',
            'Return the JSON revision only.',
          ].filter(line => line !== '').join('\n'),
          maxTokens: PLAN_MAX_TOKENS,
          temperature: 0.5,
        }, signal)
        const revision = normalizeRefinePlan(parsePlanJson(planText), project, request)
        const promptPlan = {
          title: revision.title,
          summary: revision.summary,
          style: project.style,
          revision: input.instruction,
          scenes: revision.scenes.map(entry => ({
            name: entry.name, engine: entry.engine, durationSec: entry.durationSec, brief: entry.brief,
          })),
        }
        const scenes = []
        for (let index = 0; index < revision.scenes.length; index += 1) {
          signal.throwIfAborted()
          const entry = revision.scenes[index]
          if (entry.keep) {
            scenes.push({ name: entry.name, engine: entry.engine, durationSec: entry.durationSec, brief: entry.brief, code: entry.code })
            continue
          }
          const previousCode = entry.source === null ? '' : project.scenes[entry.source].code
          const code = await generateSceneCode(route, entry.engine, promptPlan, index, request, signal, previousCode)
          scenes.push({ name: entry.name, engine: entry.engine, durationSec: entry.durationSec, brief: entry.brief, code })
        }
        const durationSec = Math.round(scenes.reduce((sum, scene) => sum + scene.durationSec, 0) * 10) / 10
        let audio = project.audio
        let audioBrief = project.audioBrief ?? ''
        let audioError = ''
        if (request.sound === false) {
          audio = undefined
          audioBrief = ''
        } else if (revision.audioBrief !== '') {
          try {
            const code = await generateAudioCode(route, {
              title: revision.title,
              summary: revision.summary,
              style: project.style,
              audioBrief: revision.audioBrief,
            }, { ...request, durationSec }, signal)
            audio = { code, brief: revision.audioBrief }
            audioBrief = revision.audioBrief
          } catch (error) {
            audioError = error instanceof Error ? error.message : String(error)
            audioBrief = revision.audioBrief
          }
        }
        let dialog = Array.isArray(project.dialog) ? project.dialog : []
        const wantsVoice = /голос|озвуч|диалог|реплик|скажи|сказа|voice|speak|dialog|narrat/i.test(input.instruction)
        if (request.sound === false) {
          dialog = []
        } else if (wantsVoice || revision.audioBrief !== '' || dialog.length === 0) {
          try {
            dialog = await generateDialog(route, {
              title: revision.title,
              summary: revision.summary,
              style: project.style,
              scenes: promptPlan.scenes,
            }, { ...request, prompt: input.instruction, durationSec }, durationSec, signal)
          } catch {
            /* keep the current lines when the dialogue call fails */
          }
        }
        return {
          project: {
            ...project,
            title: revision.title,
            summary: revision.summary,
            scenes,
            modelKind: revision.modelKind ?? project.modelKind,
            audioBrief,
            dialog,
            ...(audio === undefined ? {} : { audio }),
            ...(audioError === '' ? {} : { audioError }),
            provider: route.provider,
            model: route.model,
            updatedAt: new Date().toISOString(),
          },
          reply: revision.reply,
        }
      } catch (error) {
        if (error instanceof StudioError) throw error
        const reason = error instanceof Error ? error.message : String(error)
        throw new StudioError('REFINE_FAILED', `Revision failed: ${reason}`, 500)
      }
    })
  }

  /**
   * Report the route the studio would use, so the panel can name the model.
   * @returns {Promise<any>} the model badge payload.
   */
  async function info() {
    try {
      const route = await resolveRoute(ctx, settings)
      let models = []
      try {
        models = await route.llm.listModels(route.provider)
      } catch {
        models = []
      }
      return {
        ok: true,
        provider: route.provider,
        model: route.model,
        models: (Array.isArray(models) ? models : []).slice(0, 60).map(row => ({ id: row.id, name: row.name })),
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  return { generate, refine, info }
}

/**
 * JSON response helper.
 * @param {unknown} value - JSON body.
 * @param {number} status - HTTP status.
 * @returns {Response} the response.
 */
function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

/**
 * Run one route body and map failures onto a JSON response.
 * @param {() => Promise<unknown>} work - the operation.
 * @returns {Promise<Response>} the response.
 */
async function respond(work) {
  try {
    return json(await work())
  } catch (error) {
    if (error instanceof StudioError) {
      return json({ ok: false, code: error.code, error: error.message }, error.status)
    }
    const reason = error instanceof Error ? error.message : String(error)
    return json({ ok: false, code: 'INTERNAL', error: reason }, 500)
  }
}

/** Required service: the authenticated exact Fetch route registry (`/api`). */
export const inject = ['connection']

/**
 * Host plugin entry: register the exact Fetch routes and the agent tools.
 * @param {any} ctx - plugin context.
 * @param {any} config - row config (`provider`, `model`, `timeoutMs`).
 */
export function apply(ctx, config = {}) {
  const settings = {
    provider: typeof config.provider === 'string' && config.provider !== '' ? config.provider : undefined,
    model: typeof config.model === 'string' && config.model !== '' ? config.model : undefined,
    timeoutMs: Math.min(600_000, Math.max(30_000, Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS)),
  }
  const studio = createStudio(ctx, settings)

  ctx.connection.fetch.register({
    path: INFO_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => respond(async () => ({ ok: true, ...(await studio.info()) })),
  })

  ctx.connection.fetch.register({
    path: GENERATE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        return json({ ok: false, code: 'INVALID_BODY', error: 'The request body must be JSON.' }, 400)
      }
      return respond(async () => ({ ok: true, project: await studio.generate(body, request.signal) }))
    },
  })

  ctx.connection.fetch.register({
    path: REFINE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        return json({ ok: false, code: 'INVALID_BODY', error: 'The request body must be JSON.' }, 400)
      }
      return respond(async () => {
        const revised = await studio.refine(body, request.signal)
        return { ok: true, project: revised.project, reply: revised.reply }
      })
    },
  })

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register({
      name: 'neural_video_generate',
      description: [
        'Generate a short procedural video project from a prompt: the model plans 2-3 scenes and writes',
        'the renderer for each one (Canvas2D drawing code for 2D scenes, a WebGL1 fragment shader for 3D scenes,',
        'an animate() control function for a scene that shows a user-uploaded 3D model with engine "mesh").',
        'Returns the scene code plus film metadata. The user renders, records and refines it in the Neural video studio panel',
        '(left sidebar). Use it when the user asks for a generated video, animation, motion graphic, or short film.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What the video should show. Concrete imagery, mood, colors and motion work best.' },
          mode: { type: 'string', enum: ['2d', '3d', 'mixed'], description: 'Rendering engine for every scene.' },
          durationSec: { type: 'number', description: 'Total film length in seconds (2-30, default 8).' },
          fps: { type: 'integer', enum: [24, 30], description: 'Frames per second of the recording.' },
          width: { type: 'integer', description: 'Frame width in pixels (default 1280).' },
          height: { type: 'integer', description: 'Frame height in pixels (default 720).' },
          style: { type: 'string', description: 'Optional visual style keywords.' },
          continuation: { type: 'string', description: 'Optional description of earlier shots when adding to an existing film.' },
          sound: { type: 'boolean', description: 'Also generate a procedural soundtrack (default true).' },
          mesh: {
            type: 'object',
            description: 'Optional summary of a 3D model the user loaded into the studio panel ({ name, triangles, kind }). Lets the plan use engine "mesh".',
            properties: {
              name: { type: 'string' },
              triangles: { type: 'integer' },
              kind: { type: 'string', enum: MODEL_KINDS },
              parts: { type: 'array', items: { type: 'object', additionalProperties: true } },
              analysis: { type: 'object', additionalProperties: true },
            },
            required: ['name', 'triangles'],
            additionalProperties: false,
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            title: { type: 'string' },
            summary: { type: 'string' },
            modelKind: { type: 'string' },
            audioChars: { type: 'integer' },
            provider: { type: 'string' },
            model: { type: 'string' },
            error: { type: 'string' },
            scenes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  engine: { type: 'string' },
                  durationSec: { type: 'number' },
                  brief: { type: 'string' },
                  code: { type: 'string' },
                },
                required: ['name', 'engine', 'durationSec', 'code'],
                additionalProperties: false,
              },
            },
          },
          required: ['ok', 'scenes'],
          additionalProperties: false,
        },
        render: (args, value) => {
          if (value.ok !== true) return [{ type: 'text', text: `Neural video generation failed: ${value.error ?? 'unknown reason'}` }]
          const lines = [
            `Film: ${value.title ?? ''} (${value.provider ?? '?'} / ${value.model ?? '?'})`,
            `Model: ${value.modelKind === undefined || value.modelKind === '' ? 'none' : value.modelKind}`,
            `Soundtrack: ${value.audioChars > 0 ? `${value.audioChars} code characters` : 'silent'}`,
            `Scenes: ${value.scenes.map(scene => `${scene.name} [${scene.engine}, ${scene.durationSec}s]`).join(', ')}`,
            '',
          ]
          for (const [index, scene] of value.scenes.entries()) {
            lines.push(`--- scene ${index + 1}: ${scene.name} (${scene.engine}) ---`, scene.code, '')
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      execute: async (args, exec) => {
        try {
          const project = await studio.generate(args, exec.signal)
          return {
            ok: true,
            title: project.title,
            summary: project.summary,
            modelKind: project.modelKind ?? '',
            audioChars: project.audio ? project.audio.code.length : 0,
            provider: project.provider,
            model: project.model,
            scenes: project.scenes.map(scene => ({
              name: scene.name,
              engine: scene.engine,
              durationSec: scene.durationSec,
              brief: scene.brief,
              code: scene.code,
            })),
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { ok: false, error: message, scenes: [] }
        }
      },
    })

    toolCtx.tools.register({
      name: 'neural_video_refine',
      description: [
        'Revise an existing Neural video studio project from one natural-language instruction.',
        'Unchanged scenes are copied verbatim; changed and new scenes are regenerated from their current code,',
        'so a film can be refined repeatedly. Pass the project returned by neural_video_generate or a previous',
        'neural_video_refine call. The user can also refine from the studio panel.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          project: {
            type: 'object',
            description: 'The film to revise: { title, summary, style, engine, width, height, fps, scenes: [{ name, engine, durationSec, brief, code }] }.',
            additionalProperties: true,
          },
          instruction: {
            type: 'string',
            description: 'What to change, e.g. "добавь дождь и сделай неон ярче" or "make the camera orbit faster and two scenes longer".',
          },
          sound: { type: 'boolean', description: 'Keep or add a soundtrack during this revision (default true).' },
          mesh: {
            type: 'object',
            description: 'Optional summary of a loaded 3D model ({ name, triangles, kind }) so engine "mesh" stays available.',
            properties: {
              name: { type: 'string' },
              triangles: { type: 'integer' },
              kind: { type: 'string', enum: MODEL_KINDS },
              parts: { type: 'array', items: { type: 'object', additionalProperties: true } },
              analysis: { type: 'object', additionalProperties: true },
            },
            required: ['name', 'triangles'],
            additionalProperties: false,
          },
        },
        required: ['project', 'instruction'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            reply: { type: 'string' },
            error: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            audioChars: { type: 'integer' },
            scenes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  engine: { type: 'string' },
                  durationSec: { type: 'number' },
                  brief: { type: 'string' },
                  code: { type: 'string' },
                },
                required: ['name', 'engine', 'durationSec', 'code'],
                additionalProperties: false,
              },
            },
          },
          required: ['ok', 'scenes'],
          additionalProperties: false,
        },
        render: (args, value) => {
          if (value.ok !== true) return [{ type: 'text', text: `Neural video refinement failed: ${value.error ?? 'unknown reason'}` }]
          const lines = [
            `Reply: ${value.reply ?? ''}`,
            `Film: ${value.title ?? ''}`,
            `Soundtrack: ${value.audioChars > 0 ? `${value.audioChars} code characters` : 'silent'}`,
            `Scenes: ${value.scenes.map(scene => `${scene.name} [${scene.engine}, ${scene.durationSec}s]`).join(', ')}`,
          ]
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      execute: async (args, exec) => {
        try {
          const revised = await studio.refine(args, exec.signal)
          return {
            ok: true,
            reply: revised.reply,
            title: revised.project.title,
            summary: revised.project.summary,
            audioChars: revised.project.audio ? revised.project.audio.code.length : 0,
            scenes: revised.project.scenes.map(scene => ({
              name: scene.name,
              engine: scene.engine,
              durationSec: scene.durationSec,
              brief: scene.brief,
              code: scene.code,
            })),
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { ok: false, error: message, scenes: [] }
        }
      },
    })
  })
}
