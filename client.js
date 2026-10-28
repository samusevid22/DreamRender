/**
 * Browser half of the Neural video studio bundle.
 *
 * Two slot registrations make the plugin visible:
 *   - `sidebar.panellist` id `neural-video-studio` draws the left-sidebar icon
 *     and lets the sidebar select the center panel with the same id;
 *   - `main` key `neural-video-studio` renders the studio page.
 *
 * The page talks to the Host half over one authenticated exact Fetch route
 * (`/api/neural-video-studio/generate`) that turns a prompt into a plan plus
 * per-scene renderer code. Rendering itself is local: the generated code is
 * compiled inside a sandboxed `srcdoc` iframe (no same-origin access to the
 * harness page), frames are drawn into a canvas and recorded with
 * MediaRecorder, and the finished clip is handed back as a Blob.
 */
window.__ModuleLoader__.load({
  id: '@local/neural-video-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace used by the slot `t` seat and the sidebar label. */
    const NS = 'neuralVideoStudio'
    /** Sidebar entry id and main-panel key; both are the bundle's row id. */
    const PANEL_ID = 'neural-video-studio'
    const GENERATE_PATH = '/api/neural-video-studio/generate'
    const REFINE_PATH = '/api/neural-video-studio/refine'
    const INFO_PATH = '/api/neural-video-studio/info'
    const STORAGE_KEY = 'dsh.neural-video-studio.v1'
    const MAX_SHOTS = 12
    const MAX_ITERATIONS = 60
    const MAX_MESH_BYTES = 60 * 1024 * 1024
    const DURATIONS = [4, 6, 8, 10, 15, 20, 30, 45, 60]
    const RESOLUTIONS = [
      { width: 854, height: 480, label: '854 × 480' },
      { width: 1280, height: 720, label: '1280 × 720' },
      { width: 1920, height: 1080, label: '1920 × 1080' },
    ]
    const STYLE_PRESETS = [
      { key: 'style.cinematic', prompt: 'cinematic, volumetric light, film grain, shallow depth of field' },
      { key: 'style.neon', prompt: 'neon cyberpunk, magenta and cyan glow, rain, night city' },
      { key: 'style.minimal', prompt: 'minimal geometric, soft gradients, lots of negative space, pastel palette' },
      { key: 'style.organic', prompt: 'organic, flowing curves, microscopic cells, bioluminescence' },
      { key: 'style.space', prompt: 'deep space, nebulae, stars, orbital motion, hard sunlight' },
      { key: 'style.retro', prompt: 'retro 80s, scanlines, chrome grids, synthwave sunset' },
    ]

    /** Panel copy in the two shipped languages, plus a zh fallback dictionary. */
    const DICTS = {
      en: {
        panel: 'Neural video',
        'header.title': 'Neural video studio',
        'header.subtitle': 'Describe a film. The model writes the renderer — Canvas2D, a WebGL shader, or an animation for your own 3D model — and you refine it with words.',
        'form.prompt': 'What should happen on screen',
        'form.placeholder': 'A slow flight through a neon city at night, rain, reflections, camera tilts up to a giant moon…',
        'form.mode': 'Engine',
        'form.sound': 'Sound',
        'sound.on': 'With sound',
        'sound.off': 'Silent',
        'form.quality': 'Quality',
        'quality.fast': 'Fast',
        'quality.std': 'Standard',
        'quality.high': 'High',
        'form.subtitles': 'Subtitles',
        'subtitles.on': 'On',
        'subtitles.off': 'Off',
        'mode.2d': '2D',
        'mode.3d': '3D',
        'mode.mixed': 'Mixed',
        'form.duration': 'Length',
        'form.fps': 'FPS',
        'form.resolution': 'Resolution',
        'form.style': 'Style keywords (optional)',
        'form.stylePlaceholder': 'e.g. dreamy, high contrast, warm palette',
        'style.cinematic': 'Cinematic',
        'style.neon': 'Neon',
        'style.minimal': 'Minimal',
        'style.organic': 'Organic',
        'style.space': 'Deep space',
        'style.retro': 'Retro 80s',
        'action.generate': 'Write code and film',
        'action.append': 'Add another shot',
        'action.cancel': 'Cancel',
        'action.example': 'Load demo',
        'action.render': 'Render video',
        'action.download': 'Download video',
        'action.project': 'Save project (.json)',
        'action.downloadAudio': 'Download soundtrack (.wav)',
        'action.moveUp': 'Move shot up',
        'action.moveDown': 'Move shot down',
        'action.remove': 'Delete shot',
        'timeline.title': 'Timeline',
        'timeline.empty': 'No shots yet. Describe a film above, or load the built-in demo.',
        'timeline.sceneCount': 'Scenes',
        'timeline.total': 'Total',
        'code.title': 'Renderer code',
        'code.hint': 'Edit the code, then render again. 2D scenes are a draw() body; 3D scenes are a fragment shader.',
        'code.chars': '{count} characters',
        'preview.title': 'Film preview',
        'preview.empty': 'The render will appear here.',
        'preview.note': 'Recording happens in real time, so a film of N seconds takes about N seconds. Sound is synthesized offline from the soundtrack code the model writes; the result is a WebM/MP4 clip up to 60 seconds.',
        'preview.model': 'Model',
        'model.missing': 'Model unavailable',
        'status.ready': 'Ready',
        'status.planning': 'The model is planning the film and writing code',
        'status.rendering': 'Recording frames',
        'status.renderingSound': 'Recording frames with sound',
        'status.done': 'Video ready',
        'status.generated': 'Code ready — render the film',
        'status.cancelled': 'Cancelled',
        'status.scene': 'Scene {index}: {name}',
        'status.audioBuilding': 'Building the soundtrack',
        'status.audioGate': 'Click the button in the preview to enable sound',
        'status.encoding': 'Encoding frames in the background (no real-time limit)',
        'status.muxing': 'Muxing video and audio',
        'error.prompt': 'Describe the video first: at least a few words.',
        'error.empty': 'Generate a film first.',
        'error.code': 'Every scene needs code before it can be rendered.',
        'error.recorder': 'This browser has no MediaRecorder, so recording is unavailable.',
        'example.title': 'Orbital rings',
        'example.summary': 'A built-in demo: two scenes, a 2D starfield and a 3D shader flight.',
        'example.scene1': 'Starfield rings',
        'example.scene2': 'Shader core',
        'hint.generating': 'Usually 15–60 seconds: the model plans the film, then writes each scene.',
        'status.refining': 'The model is revising the film',
        'status.refined': 'Revision applied — render again',
        'status.meshLoaded': '3D model loaded',
        'mesh.title': '3D model',
        'mesh.hint': 'Load your own model and the model writes animation code for it.',
        'mesh.load': 'Load model',
        'mesh.loading': 'Reading model…',
        'mesh.formats': '.glb, .obj or .stl, up to 250k triangles',
        'mesh.triangles': 'triangles',
        'mesh.remove': 'Remove model',
        'mesh.readyHint': 'The model is ready: the plan can now use "mesh" scenes that animate it.',
        'mesh.partsCount': 'parts',
        'mesh.kind.humanoid': 'humanoid figure',
        'mesh.kind.creature': 'creature',
        'mesh.kind.vehicle': 'vehicle',
        'mesh.kind.object': 'object',
        'mesh.kind.architecture': 'architecture',
        'mesh.kind.other': 'unknown shape',
        'iter.title': 'Iterations',
        'iter.hint': 'Edit the film with words, as many times as you like.',
        'iter.empty': 'No edits yet. Generate a film, then change it: “add rain”, “camera closer”, “two seconds longer”.',
        'iter.placeholder': 'e.g. add rain, make the camera orbit faster, lengthen the last scene',
        'iter.you': 'You',
        'iter.model': 'Studio',
        'iter.applied': 'Applied the requested change.',
        'action.applyRefine': 'Apply change',
        'error.instruction': 'Write what to change: a few words are enough.',
        'error.meshSize': 'The model file is too large (max 60 MB).',
        'error.meshScene': 'This film uses a "mesh" scene, but no model is loaded. Load a .glb/.obj/.stl model.',
        'code.hintMesh': 'Mesh scene: edit animate(t, duration). Return rotation, camera, light and material controls.',
        'hint.rendering': 'Keep this panel open while recording.',
      },
      ru: {
        panel: 'Нейро-видео',
        'header.title': 'Студия нейро-видео',
        'header.subtitle': 'Опишите фильм. Нейросеть пишет код отрисовки — Canvas2D, шейдер WebGL или анимацию вашей 3D-модели, — а вы правите его словами.',
        'form.prompt': 'Что должно происходить на экране',
        'form.placeholder': 'Медленный полёт сквозь неоновый город ночью, дождь, отражения, камера поднимается к огромной луне…',
        'form.mode': 'Движок',
        'form.sound': 'Звук',
        'sound.on': 'Со звуком',
        'sound.off': 'Без звука',
        'form.quality': 'Качество',
        'quality.fast': 'Быстро',
        'quality.std': 'Стандарт',
        'quality.high': 'Высокое',
        'form.subtitles': 'Субтитры',
        'subtitles.on': 'Вкл',
        'subtitles.off': 'Выкл',
        'mode.2d': '2D',
        'mode.3d': '3D',
        'mode.mixed': 'Микс',
        'form.duration': 'Длительность',
        'form.fps': 'Кадры/с',
        'form.resolution': 'Разрешение',
        'form.style': 'Ключевые слова стиля (необязательно)',
        'form.stylePlaceholder': 'например: мечтательно, высокий контраст, тёплая палитра',
        'style.cinematic': 'Кинематограф',
        'style.neon': 'Неон',
        'style.minimal': 'Минимализм',
        'style.organic': 'Органика',
        'style.space': 'Космос',
        'style.retro': 'Ретро 80-х',
        'action.generate': 'Написать код и снять',
        'action.append': 'Добавить кадр',
        'action.cancel': 'Отмена',
        'action.example': 'Загрузить демо',
        'action.render': 'Рендерить видео',
        'action.download': 'Скачать видео',
        'action.project': 'Сохранить проект (.json)',
        'action.downloadAudio': 'Скачать звук (.wav)',
        'action.moveUp': 'Сдвинуть кадр вверх',
        'action.moveDown': 'Сдвинуть кадр вниз',
        'action.remove': 'Удалить кадр',
        'timeline.title': 'Монтаж',
        'timeline.empty': 'Пока нет кадров. Опишите фильм выше или загрузите встроенное демо.',
        'timeline.sceneCount': 'Сцен',
        'timeline.total': 'Всего',
        'code.title': 'Код отрисовки',
        'code.hint': 'Правьте код и рендерите снова. 2D — тело draw(); 3D — фрагментный шейдер.',
        'code.chars': '{count} символов',
        'preview.title': 'Предпросмотр фильма',
        'preview.empty': 'Здесь появится результат рендера.',
        'preview.note': 'Запись идёт в реальном времени: фильм на N секунд пишется примерно N секунд. Звук синтезируется офлайн по коду, который пишет нейросеть; на выходе — клип WebM/MP4 длиной до 60 секунд.',
        'preview.model': 'Модель',
        'model.missing': 'Модель недоступна',
        'status.ready': 'Готово',
        'status.planning': 'Нейросеть планирует фильм и пишет код',
        'status.rendering': 'Запись кадров',
        'status.renderingSound': 'Запись кадров со звуком',
        'status.done': 'Видео готово',
        'status.generated': 'Код готов — можно рендерить',
        'status.cancelled': 'Отменено',
        'status.scene': 'Сцена {index}: {name}',
        'status.audioBuilding': 'Собираю звуковую дорожку',
        'status.audioGate': 'Нажмите кнопку в предпросмотре, чтобы включить звук',
        'status.encoding': 'Кодирую кадры в фоне (без ограничения реального времени)',
        'status.muxing': 'Собираю видео и звук в один файл',
        'error.prompt': 'Сначала опишите видео: хотя бы несколько слов.',
        'error.empty': 'Сначала создайте фильм.',
        'error.code': 'У каждой сцены должен быть код, иначе рендерить нечего.',
        'error.recorder': 'В этом браузере нет MediaRecorder — запись недоступна.',
        'example.title': 'Орбитальные кольца',
        'example.summary': 'Встроенное демо: две сцены — 2D-звёздное поле и 3D-полёт в шейдере.',
        'example.scene1': 'Звёздные кольца',
        'example.scene2': 'Ядро в шейдере',
        'hint.generating': 'Обычно 15–60 секунд: сначала план фильма, потом код каждой сцены.',
        'status.refining': 'Нейросеть правит фильм',
        'status.refined': 'Правка применена — рендерите снова',
        'status.meshLoaded': '3D-модель загружена',
        'mesh.title': '3D-модель',
        'mesh.hint': 'Загрузите свою модель — нейросеть напишет для неё анимацию.',
        'mesh.load': 'Загрузить модель',
        'mesh.loading': 'Читаю модель…',
        'mesh.formats': '.glb, .obj или .stl, до 250 тыс. треугольников',
        'mesh.triangles': 'треугольников',
        'mesh.remove': 'Убрать модель',
        'mesh.readyHint': 'Модель готова: план может использовать «mesh»-сцены с её анимацией.',
        'mesh.partsCount': 'частей',
        'mesh.kind.humanoid': 'гуманоид',
        'mesh.kind.creature': 'существо',
        'mesh.kind.vehicle': 'транспорт',
        'mesh.kind.object': 'предмет',
        'mesh.kind.architecture': 'архитектура',
        'mesh.kind.other': 'неизвестная форма',
        'iter.title': 'Итерации',
        'iter.hint': 'Правьте фильм словами — сколько угодно раз.',
        'iter.empty': 'Правок пока нет. Снимите фильм и меняйте его: «добавь дождь», «камеру ближе», «на две секунды длиннее».',
        'iter.placeholder': 'например: добавь дождь, камера облетает быстрее, удлини последнюю сцену',
        'iter.you': 'Вы',
        'iter.model': 'Студия',
        'iter.applied': 'Правка применена.',
        'action.applyRefine': 'Применить правку',
        'error.instruction': 'Напишите, что изменить: достаточно нескольких слов.',
        'error.meshSize': 'Файл модели слишком большой (максимум 60 МБ).',
        'error.meshScene': 'В фильме есть «mesh»-сцена, но модель не загружена. Загрузите .glb/.obj/.stl.',
        'code.hintMesh': 'Mesh-сцена: правьте animate(t, duration). Верните управление поворотом, камерой, светом и материалом.',
        'hint.rendering': 'Не закрывайте панель во время записи.',
      },
    }

    /** Built-in 2D demo scene: deterministic, no external resources. */
    const EXAMPLE_2D = [
      '// Seeded pseudo-random helper.',
      'function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }',
      'const progress = Math.min(1, t / duration)',
      '',
      '// Background: deep radial gradient.',
      'const bg = ctx.createRadialGradient(W * 0.5, H * 0.55, 0, W * 0.5, H * 0.55, Math.max(W, H) * 0.75)',
      'bg.addColorStop(0, "#141d2f")',
      'bg.addColorStop(0.55, "#080b14")',
      'bg.addColorStop(1, "#020306")',
      'ctx.fillStyle = bg',
      'ctx.fillRect(0, 0, W, H)',
      '',
      '// Starfield with parallax drift.',
      'for (let i = 0; i < 220; i += 1) {',
      '  const rx = hash(i + 1)',
      '  const ry = hash(i + 97)',
      '  const depth = 0.25 + hash(i + 211) * 0.75',
      '  const x = (rx * W + t * 12 * depth) % W',
      '  const y = ry * H + Math.sin(t * 0.6 + i) * 2 * depth',
      '  ctx.globalAlpha = 0.25 + depth * 0.6',
      '  ctx.fillStyle = "#cfe8ff"',
      '  ctx.beginPath()',
      '  ctx.arc(x, y, 0.4 + depth * 1.6, 0, Math.PI * 2)',
      '  ctx.fill()',
      '}',
      'ctx.globalAlpha = 1',
      '',
      '// Central orbital rings.',
      'ctx.save()',
      'ctx.translate(W * 0.5, H * 0.52)',
      'for (let ring = 0; ring < 3; ring += 1) {',
      '  const phase = t * (0.5 + ring * 0.25) + ring * 1.7',
      '  ctx.save()',
      '  ctx.rotate(phase * 0.35)',
      '  ctx.scale(1, 0.42)',
      '  ctx.lineWidth = Math.max(1.5, (W * 0.0032) / (1 + ring * 0.4))',
      '  ctx.strokeStyle = ring === 1 ? "#7fe7ff" : "#5b7cff"',
      '  ctx.shadowColor = ring === 1 ? "#7fe7ff" : "#5b7cff"',
      '  ctx.shadowBlur = W * 0.02',
      '  ctx.beginPath()',
      '  ctx.arc(0, 0, W * (0.14 + ring * 0.085), 0, Math.PI * 2)',
      '  ctx.stroke()',
      '  ctx.restore()',
      '}',
      '',
      '// Pulsing core.',
      'const pulse = 0.85 + Math.sin(t * 2.4) * 0.12 + progress * 0.05',
      'const core = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.11 * pulse)',
      'core.addColorStop(0, "rgba(255,255,255,0.95)")',
      'core.addColorStop(0.35, "rgba(127,231,255,0.75)")',
      'core.addColorStop(1, "rgba(91,124,255,0)")',
      'ctx.fillStyle = core',
      'ctx.beginPath()',
      'ctx.arc(0, 0, W * 0.11 * pulse, 0, Math.PI * 2)',
      'ctx.fill()',
      '',
      '// Orbiting motes.',
      'for (let i = 0; i < 60; i += 1) {',
      '  const a = t * (0.4 + hash(i + 31) * 0.8) + hash(i + 71) * Math.PI * 2',
      '  const radius = W * (0.16 + hash(i + 13) * 0.3)',
      '  const x = Math.cos(a) * radius',
      '  const y = Math.sin(a) * radius * 0.42',
      '  ctx.globalAlpha = 0.35 + hash(i + 53) * 0.55',
      '  ctx.fillStyle = "#dff6ff"',
      '  ctx.beginPath()',
      '  ctx.arc(x, y, 1.1 + hash(i + 5) * 1.6, 0, Math.PI * 2)',
      '  ctx.fill()',
      '}',
      'ctx.restore()',
      'ctx.globalAlpha = 1',
      '',
      '// Vignette.',
      'const vignette = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.35, W * 0.5, H * 0.5, Math.max(W, H) * 0.75)',
      'vignette.addColorStop(0, "rgba(0,0,0,0)")',
      'vignette.addColorStop(1, "rgba(0,0,0,0.55)")',
      'ctx.fillStyle = vignette',
      'ctx.fillRect(0, 0, W, H)',
    ].join('\n')

    /** Built-in 3D demo scene: conservative WebGL1 shader with one main(). */
    const EXAMPLE_3D = [
      'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
      'float noise(vec2 p) {',
      '  vec2 i = floor(p);',
      '  vec2 f = fract(p);',
      '  vec2 u = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
      '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
      '}',
      'void main() {',
      '  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;',
      '  float t = u_time;',
      '  vec3 col = vec3(0.02, 0.03, 0.06);',
      '  vec3 glow = vec3(0.25, 0.55, 1.0);',
      '  for (int i = 0; i < 3; i++) {',
      '    float fi = float(i);',
      '    float radius = 0.22 + fi * 0.13 + 0.02 * sin(t * 0.9 + fi * 2.1);',
      '    float angle = atan(uv.y, uv.x) + t * (0.25 + fi * 0.15);',
      '    vec2 p = vec2(cos(angle), sin(angle)) * radius;',
      '    float d = length(uv - p);',
      '    float orbit = 1.0 - smoothstep(0.0, 0.055, d);',
      '    col += glow * orbit * (0.7 - fi * 0.15);',
      '    col += glow * 0.08 / (abs(d) * 6.0 + 0.15);',
      '  }',
      '  float coreDist = length(uv);',
      '  col += vec3(1.0, 0.95, 0.85) * 0.35 / (coreDist * coreDist * 18.0 + 0.35);',
      '  float neb = noise(uv * 2.6 + vec2(t * 0.05, -t * 0.03));',
      '  col += vec3(0.16, 0.08, 0.3) * neb * 0.5;',
      '  col = pow(col, vec3(0.85));',
      '  float edge = length(uv * vec2(1.0, 1.25));',
      '  col *= 1.0 - smoothstep(0.25, 0.95, edge);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n')

    // #region mesh-parsers
    /**
     * Decode a base64 payload (glTF embedded buffers) into bytes.
     * @param {string} text - base64 text.
     * @returns {Uint8Array} decoded bytes.
     */
    function base64Bytes(text) {
      const binary = atob(text)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      return bytes
    }

    /** Maximum accepted triangle count of an uploaded model. */
    const MESH_MAX_TRIANGLES = 250000

    /**
     * Turn raw triangle data into a normalized non-indexed mesh: centered on the
     * origin, scaled so its largest extent is 2, with unit normals and the
     * normalized Y bounds the renderer needs for growth/contact shadow.
     * @param {ArrayLike<number>} positions - flat xyz positions.
     * @param {ArrayLike<number> | null} normals - flat xyz normals, or null to compute facets.
     * @returns {{ positions: Float32Array, normals: Float32Array, triangles: number, minY: number, maxY: number }} the mesh.
     */
    function buildMesh(positions, normals) {
      if (positions.length < 9) throw new Error('The model has no triangles.')
      const triangles = Math.floor(positions.length / 9)
      if (triangles > MESH_MAX_TRIANGLES) {
        throw new Error(`The model has ${triangles} triangles; the studio accepts up to ${MESH_MAX_TRIANGLES}.`)
      }
      let minX = Infinity, minY = Infinity, minZ = Infinity
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
      for (let index = 0; index < positions.length; index += 3) {
        const x = positions[index], y = positions[index + 1], z = positions[index + 2]
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (z < minZ) minZ = z
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        if (z > maxZ) maxZ = z
      }
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2
      const centerZ = (minZ + maxZ) / 2
      const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ)
      if (!Number.isFinite(extent) || extent <= 0) throw new Error('The model has no measurable size.')
      const scale = 2 / extent
      const outPositions = new Float32Array(positions.length)
      for (let index = 0; index < positions.length; index += 3) {
        outPositions[index] = (positions[index] - centerX) * scale
        outPositions[index + 1] = (positions[index + 1] - centerY) * scale
        outPositions[index + 2] = (positions[index + 2] - centerZ) * scale
      }
      const outNormals = new Float32Array(positions.length)
      if (normals !== null && normals.length === positions.length) {
        for (let index = 0; index < normals.length; index += 3) {
          const length = Math.hypot(normals[index], normals[index + 1], normals[index + 2]) || 1
          outNormals[index] = normals[index] / length
          outNormals[index + 1] = normals[index + 1] / length
          outNormals[index + 2] = normals[index + 2] / length
        }
      } else {
        for (let triangle = 0; triangle < triangles; triangle += 1) {
          const base = triangle * 9
          const ax = outPositions[base], ay = outPositions[base + 1], az = outPositions[base + 2]
          const bx = outPositions[base + 3], by = outPositions[base + 4], bz = outPositions[base + 5]
          const cx = outPositions[base + 6], cy = outPositions[base + 7], cz = outPositions[base + 8]
          const ux = bx - ax, uy = by - ay, uz = bz - az
          const vx = cx - ax, vy = cy - ay, vz = cz - az
          let nx = uy * vz - uz * vy
          let ny = uz * vx - ux * vz
          let nz = ux * vy - uy * vx
          const length = Math.hypot(nx, ny, nz) || 1
          nx /= length
          ny /= length
          nz /= length
          for (let corner = 0; corner < 3; corner += 1) {
            outNormals[base + corner * 3] = nx
            outNormals[base + corner * 3 + 1] = ny
            outNormals[base + corner * 3 + 2] = nz
          }
        }
      }
      let normMinY = Infinity
      let normMaxY = -Infinity
      for (let index = 1; index < outPositions.length; index += 3) {
        if (outPositions[index] < normMinY) normMinY = outPositions[index]
        if (outPositions[index] > normMaxY) normMaxY = outPositions[index]
      }
      return { positions: outPositions, normals: outNormals, triangles, minY: normMinY, maxY: normMaxY }
    }

    /**
     * Segment a normalized mesh into a handful of rigid parts and guess what the
     * model represents, so the model can animate limbs instead of spinning the
     * whole object. Deterministic: farthest-point seeds and fixed iterations.
     * @param {Float32Array} positions - normalized positions.
     * @returns {{ partIndex: Float32Array, parts: Array<any>, analysis: any }} segmentation and classification.
     */
    function analyzeMesh(positions) {
      const vertexCount = positions.length / 3
      if (vertexCount < 6) throw new Error('The model has too few vertices to analyse.')
      let minX = Infinity, minY = Infinity, minZ = Infinity
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
      for (let index = 0; index < positions.length; index += 3) {
        if (positions[index] < minX) minX = positions[index]
        if (positions[index + 1] < minY) minY = positions[index + 1]
        if (positions[index + 2] < minZ) minZ = positions[index + 2]
        if (positions[index] > maxX) maxX = positions[index]
        if (positions[index + 1] > maxY) maxY = positions[index + 1]
        if (positions[index + 2] > maxZ) maxZ = positions[index + 2]
      }
      const sizeX = maxX - minX || 1
      const sizeY = maxY - minY || 1
      const sizeZ = maxZ - minZ || 1
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2
      const centerZ = (minZ + maxZ) / 2
      const maxSize = Math.max(sizeX, sizeY, sizeZ)
      const center = [centerX, centerY, centerZ]

      // --- deterministic k-means over a vertex sample ---
      const targetSamples = 6000
      const stride = Math.max(1, Math.floor(vertexCount / targetSamples))
      const samples = []
      for (let vertex = 0; vertex < vertexCount; vertex += stride) {
        samples.push([positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]])
      }
      const clusters = 8
      const centroids = []
      const mean = [0, 0, 0]
      for (const sample of samples) {
        mean[0] += sample[0]
        mean[1] += sample[1]
        mean[2] += sample[2]
      }
      mean[0] /= samples.length
      mean[1] /= samples.length
      mean[2] /= samples.length
      centroids.push(mean)
      while (centroids.length < clusters) {
        let best = 0
        let bestDistance = -1
        for (let index = 0; index < samples.length; index += 1) {
          let nearest = Infinity
          for (const spot of centroids) {
            const dx = samples[index][0] - spot[0]
            const dy = samples[index][1] - spot[1]
            const dz = samples[index][2] - spot[2]
            const distance = dx * dx + dy * dy + dz * dz
            if (distance < nearest) nearest = distance
          }
          if (nearest > bestDistance) { bestDistance = nearest; best = index }
        }
        centroids.push([samples[best][0], samples[best][1], samples[best][2]])
      }
      for (let iteration = 0; iteration < 10; iteration += 1) {
        const sums = centroids.map(() => [0, 0, 0, 0])
        for (const sample of samples) {
          let nearest = 0
          let nearestDistance = Infinity
          for (let cluster = 0; cluster < centroids.length; cluster += 1) {
            const dx = sample[0] - centroids[cluster][0]
            const dy = sample[1] - centroids[cluster][1]
            const dz = sample[2] - centroids[cluster][2]
            const distance = dx * dx + dy * dy + dz * dz
            if (distance < nearestDistance) { nearestDistance = distance; nearest = cluster }
          }
          sums[nearest][0] += sample[0]
          sums[nearest][1] += sample[1]
          sums[nearest][2] += sample[2]
          sums[nearest][3] += 1
        }
        for (let cluster = 0; cluster < centroids.length; cluster += 1) {
          if (sums[cluster][3] === 0) continue
          centroids[cluster][0] = sums[cluster][0] / sums[cluster][3]
          centroids[cluster][1] = sums[cluster][1] / sums[cluster][3]
          centroids[cluster][2] = sums[cluster][2] / sums[cluster][3]
        }
      }

      // --- assign every triangle (and therefore every vertex) to one cluster ---
      const triangleCount = vertexCount / 3
      const partIndex = new Float32Array(vertexCount)
      const stats = centroids.map(() => ({
        count: 0, sumX: 0, sumY: 0, sumZ: 0,
        minX: Infinity, minY: Infinity, minZ: Infinity,
        maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
      }))
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const base = triangle * 9
        const cx = (positions[base] + positions[base + 3] + positions[base + 6]) / 3
        const cy = (positions[base + 1] + positions[base + 4] + positions[base + 7]) / 3
        const cz = (positions[base + 2] + positions[base + 5] + positions[base + 8]) / 3
        let nearest = 0
        let nearestDistance = Infinity
        for (let cluster = 0; cluster < centroids.length; cluster += 1) {
          const dx = cx - centroids[cluster][0]
          const dy = cy - centroids[cluster][1]
          const dz = cz - centroids[cluster][2]
          const distance = dx * dx + dy * dy + dz * dz
          if (distance < nearestDistance) { nearestDistance = distance; nearest = cluster }
        }
        const info = stats[nearest]
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = triangle * 3 + corner
          partIndex[vertex] = nearest
          const x = positions[vertex * 3]
          const y = positions[vertex * 3 + 1]
          const z = positions[vertex * 3 + 2]
          info.count += 1
          info.sumX += x
          info.sumY += y
          info.sumZ += z
          if (x < info.minX) info.minX = x
          if (y < info.minY) info.minY = y
          if (z < info.minZ) info.minZ = z
          if (x > info.maxX) info.maxX = x
          if (y > info.maxY) info.maxY = y
          if (z > info.maxZ) info.maxZ = z
        }
      }

      // --- part table with mirror partners and limb score ---
      const parts = stats.map((info, index) => {
        const count = Math.max(1, info.count)
        const partCenter = [info.sumX / count, info.sumY / count, info.sumZ / count]
        const partSize = info.count === 0
          ? [0, 0, 0]
          : [info.maxX - info.minX, info.maxY - info.minY, info.maxZ - info.minZ]
        const smallest = Math.max(0.0001, Math.min(partSize[0], partSize[1], partSize[2]))
        const elongation = Math.max(partSize[0], partSize[1], partSize[2]) / smallest
        const offset = Math.hypot(partCenter[0] - centerX, partCenter[1] - centerY, partCenter[2] - centerZ) / (maxSize * 0.5)
        const limb = Math.min(1, Math.max(0, (elongation - 1.15) / 1.6)) * Math.min(1, Math.max(0, offset / 0.55))
        return {
          index,
          center: partCenter.map(value => Math.round(value * 100) / 100),
          size: partSize.map(value => Math.round(value * 100) / 100),
          share: Math.round((info.count / vertexCount) * 1000) / 1000,
          limb: Math.round(limb * 100) / 100,
          mirror: -1,
        }
      })
      const meaningful = parts.filter(part => part.share > 0.01)
      for (const part of meaningful) {
        const mirrored = [-part.center[0], part.center[1], part.center[2]]
        let best = null
        let bestDistance = Infinity
        for (const other of meaningful) {
          if (other.index === part.index) continue
          const dx = other.center[0] - mirrored[0]
          const dy = other.center[1] - mirrored[1]
          const dz = other.center[2] - mirrored[2]
          const distance = Math.hypot(dx, dy, dz)
          if (distance < bestDistance) { bestDistance = distance; best = other }
        }
        if (best !== null && bestDistance < maxSize * 0.32) {
          const shareRatio = Math.max(part.share, best.share) / Math.max(0.001, Math.min(part.share, best.share))
          if (shareRatio < 3) {
            part.mirror = best.index
            best.mirror = part.index
          }
        }
      }
      const symmetryShare = parts.reduce((sum, part) => sum + (part.mirror >= 0 ? part.share : 0), 0)
      const limbParts = parts.filter(part => part.limb >= 0.45).length
      const vertical = sizeY >= Math.max(sizeX, sizeZ) * 1.15
      const horizontal = Math.max(sizeX, sizeZ) >= sizeY * 1.3
      const flat = sizeY <= Math.max(sizeX, sizeZ) * 0.42
      let kind
      if (vertical && symmetryShare > 0.45 && limbParts >= 3) kind = 'humanoid'
      else if (horizontal && symmetryShare > 0.4 && limbParts >= 3) kind = 'creature'
      else if (flat && horizontal && symmetryShare > 0.35) kind = 'vehicle'
      else if (flat && !horizontal) kind = 'architecture'
      else if (vertical && symmetryShare > 0.4) kind = 'humanoid'
      else kind = 'object'
      const round = value => Math.round(value * 100) / 100
      return {
        partIndex,
        parts,
        analysis: {
          kind,
          extents: [round(sizeX), round(sizeY), round(sizeZ)],
          proportions: {
            heightToWidth: round(sizeY / Math.max(0.0001, Math.max(sizeX, sizeZ))),
            symmetry: round(symmetryShare),
            limbParts,
          },
        },
      }
    }

    /**
     * Bake a cheap ambient-occlusion term per vertex with a voxel occupancy grid
     * and short hemisphere rays. It darkens crevices, armpits and folds, which is
     * what makes faceless humanoids read as solid volumes instead of flat plastic.
     * @param {Float32Array} positions - normalized positions.
     * @param {Float32Array} normals - normalized normals.
     * @returns {Float32Array} occlusion factor 0..1 per vertex.
     */
    function bakeAmbientOcclusion(positions, normals) {
      const vertexCount = positions.length / 3
      const grid = 48
      const cell = 2 / grid
      const occupancy = new Uint8Array(grid * grid * grid)
      const gridIndex = (x, y, z) => {
        const ix = Math.floor((x + 1) / cell)
        const iy = Math.floor((y + 1) / cell)
        const iz = Math.floor((z + 1) / cell)
        if (ix < 0 || ix >= grid || iy < 0 || iy >= grid || iz < 0 || iz >= grid) return -1
        return ix + iy * grid + iz * grid * grid
      }
      for (let vertex = 0; vertex < vertexCount; vertex += 3) {
        const base = vertex * 3
        const ax = positions[base], ay = positions[base + 1], az = positions[base + 2]
        const bx = positions[base + 3], by = positions[base + 4], bz = positions[base + 5]
        const cx = positions[base + 6], cy = positions[base + 7], cz = positions[base + 8]
        for (const point of [[ax, ay, az], [bx, by, bz], [cx, cy, cz], [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3]]) {
          const index = gridIndex(point[0], point[1], point[2])
          if (index >= 0) occupancy[index] = 1
        }
      }
      const cache = new Map()
      const occlusion = new Float32Array(vertexCount)
      const steps = vertexCount > 240000 ? [0.035, 0.1, 0.19] : [0.03, 0.075, 0.13, 0.2]
      const dirs = [
        [0, 0, 1], [0.85, 0, 0.53], [-0.85, 0, 0.53], [0, 0.85, 0.53],
        [0, -0.85, 0.53], [0.6, 0.6, 0.53], [-0.6, -0.6, 0.53], [0.6, -0.6, 0.53],
      ]
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const base = vertex * 3
        const x = positions[base], y = positions[base + 1], z = positions[base + 2]
        const key = ((Math.round((x + 1) * 512) * 1024 + Math.round((y + 1) * 512)) * 1024) + Math.round((z + 1) * 512)
        let value = cache.get(key)
        if (value === undefined) {
          let nx = normals[base], ny = normals[base + 1], nz = normals[base + 2]
          const normalLength = Math.hypot(nx, ny, nz) || 1
          nx /= normalLength
          ny /= normalLength
          nz /= normalLength
          const helper = Math.abs(ny) < 0.9 ? [0, 1, 0] : [1, 0, 0]
          let tx = helper[1] * nz - helper[2] * ny
          let ty = helper[2] * nx - helper[0] * nz
          let tz = helper[0] * ny - helper[1] * nx
          const tangentLength = Math.hypot(tx, ty, tz) || 1
          tx /= tangentLength
          ty /= tangentLength
          tz /= tangentLength
          const bx = ny * tz - nz * ty
          const by = nz * tx - nx * tz
          const bz = nx * ty - ny * tx
          const originCell = gridIndex(x, y, z)
          let hits = 0
          for (const dir of dirs) {
            let rx = tx * dir[0] + bx * dir[1] + nx * dir[2]
            let ry = ty * dir[0] + by * dir[1] + ny * dir[2]
            let rz = tz * dir[0] + bz * dir[1] + nz * dir[2]
            const length = Math.hypot(rx, ry, rz) || 1
            rx /= length
            ry /= length
            rz /= length
            for (const step of steps) {
              const px = x + rx * step
              const py = y + ry * step
              const pz = z + rz * step
              const index = gridIndex(px, py, pz)
              if (index < 0 || index === originCell) continue
              if (occupancy[index] === 1) { hits += 1; break }
            }
          }
          value = 1 - (hits / dirs.length) * 0.85
          cache.set(key, value)
        }
        occlusion[vertex] = value
      }
      return occlusion
    }

    /**
     * Parse a Wavefront OBJ file into triangle data.
     * @param {string} text - file contents.
     * @returns {{ positions: number[], normals: number[] | null }} flat triangle data.
     */
    function parseObjMesh(text) {
      const sourceVertices = []
      const sourceNormals = []
      const positions = []
      const normals = []
      let complete = true
      const resolve = (index, length) => index < 0 ? length + index : index - 1
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (line === '' || line.startsWith('#')) continue
        const parts = line.split(/\s+/)
        const tag = parts[0]
        if (tag === 'v' && parts.length >= 4) {
          sourceVertices.push(Number(parts[1]), Number(parts[2]), Number(parts[3]))
        } else if (tag === 'vn' && parts.length >= 4) {
          sourceNormals.push(Number(parts[1]), Number(parts[2]), Number(parts[3]))
        } else if (tag === 'f' && parts.length >= 4) {
          const corners = []
          for (let index = 1; index < parts.length; index += 1) {
            const tokens = parts[index].split('/')
            const vertexIndex = resolve(Number.parseInt(tokens[0], 10), sourceVertices.length / 3)
            const normalIndex = tokens.length >= 3 && tokens[2] !== ''
              ? resolve(Number.parseInt(tokens[2], 10), sourceNormals.length / 3)
              : -1
            corners.push({ vertexIndex, normalIndex })
          }
          for (let corner = 1; corner + 1 < corners.length; corner += 1) {
            const triangle = [corners[0], corners[corner], corners[corner + 1]]
            for (const point of triangle) {
              positions.push(
                sourceVertices[point.vertexIndex * 3],
                sourceVertices[point.vertexIndex * 3 + 1],
                sourceVertices[point.vertexIndex * 3 + 2],
              )
            }
            const hasTriangleNormals = sourceNormals.length > 0
              && triangle.every(point => point.normalIndex >= 0 && point.normalIndex * 3 + 2 < sourceNormals.length)
            if (hasTriangleNormals) {
              for (const point of triangle) {
                normals.push(
                  sourceNormals[point.normalIndex * 3],
                  sourceNormals[point.normalIndex * 3 + 1],
                  sourceNormals[point.normalIndex * 3 + 2],
                )
              }
            } else {
              complete = false
              normals.push(0, 0, 0, 0, 0, 0, 0, 0, 0)
            }
          }
        }
      }
      // A file with any normal-less triangle gets flat facet normals for all of them.
      return { positions, normals: complete && normals.length === positions.length ? normals : null }
    }

    /**
     * Parse an ASCII or binary STL file into triangle data.
     * @param {ArrayBuffer} buffer - file bytes.
     * @returns {{ positions: number[], normals: number[] | null }} flat triangle data.
     */
    function parseStlMesh(buffer) {
      const view = new DataView(buffer)
      if (buffer.byteLength >= 84) {
        const count = view.getUint32(80, true)
        if (84 + count * 50 === buffer.byteLength) {
          const positions = []
          const normals = []
          let offset = 84
          for (let triangle = 0; triangle < count; triangle += 1) {
            const nx = view.getFloat32(offset, true)
            const ny = view.getFloat32(offset + 4, true)
            const nz = view.getFloat32(offset + 8, true)
            for (let corner = 0; corner < 3; corner += 1) {
              positions.push(
                view.getFloat32(offset + 12 + corner * 12, true),
                view.getFloat32(offset + 16 + corner * 12, true),
                view.getFloat32(offset + 20 + corner * 12, true),
              )
            }
            normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
            offset += 50
          }
          return { positions, normals }
        }
      }
      const text = new TextDecoder().decode(buffer)
      const vertices = [...text.matchAll(/vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g)]
      if (vertices.length === 0) throw new Error('The STL file has no vertices.')
      const positions = []
      for (const match of vertices) positions.push(Number(match[1]), Number(match[2]), Number(match[3]))
      const facetNormals = [...text.matchAll(/facet\s+normal\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g)]
      let normals = null
      if (facetNormals.length * 9 === positions.length) {
        normals = []
        for (const match of facetNormals) {
          const nx = Number(match[1]), ny = Number(match[2]), nz = Number(match[3])
          normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
        }
      }
      return { positions, normals }
    }

    /**
     * Parse a binary glTF (GLB) file: mesh primitives of the default scene with
     * node transforms applied. Textures and materials are ignored on purpose.
     * @param {ArrayBuffer} buffer - file bytes.
     * @returns {{ positions: number[], normals: number[] | null }} flat triangle data.
     */
    function parseGlbMesh(buffer) {
      const view = new DataView(buffer)
      if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546C67) {
        throw new Error('This is not a GLB file.')
      }
      const total = view.getUint32(8, true)
      let offset = 12
      let json = null
      let binaryView = null
      while (offset + 8 <= Math.min(total, buffer.byteLength)) {
        const chunkLength = view.getUint32(offset, true)
        const chunkType = view.getUint32(offset + 4, true)
        const start = offset + 8
        if (chunkType === 0x4E4F534A) {
          const jsonText = new TextDecoder().decode(new Uint8Array(buffer, start, chunkLength)).replace(/[\u0000\s]+$/g, '')
          json = JSON.parse(jsonText)
        } else if (chunkType === 0x004E4942) {
          binaryView = new DataView(buffer, start, chunkLength)
        }
        offset = start + chunkLength
      }
      if (json === null) throw new Error('The GLB file has no JSON chunk.')
      if (binaryView === null) {
        const uri = json.buffers?.[0]?.uri
        if (typeof uri === 'string' && uri.startsWith('data:')) {
          const bytes = base64Bytes(uri.slice(uri.indexOf(',') + 1))
          binaryView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        }
      }
      if (binaryView === null) throw new Error('The GLB file has no binary buffer.')
      const accessorNumbers = (index) => {
        const accessor = json.accessors[index]
        const bufferView = json.bufferViews[accessor.bufferView]
        const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type] ?? 1
        const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
        const readers = {
          5120: (at) => binaryView.getInt8(at),
          5121: (at) => binaryView.getUint8(at),
          5122: (at) => binaryView.getInt16(at, true),
          5123: (at) => binaryView.getUint16(at, true),
          5125: (at) => binaryView.getUint32(at, true),
          5126: (at) => binaryView.getFloat32(at, true),
        }
        const componentSize = sizes[accessor.componentType] ?? 4
        const stride = bufferView.byteStride ?? components * componentSize
        const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
        const read = readers[accessor.componentType]
        const out = new Array(accessor.count * components)
        for (let item = 0; item < accessor.count; item += 1) {
          for (let component = 0; component < components; component += 1) {
            out[item * components + component] = read(base + item * stride + component * componentSize)
          }
        }
        return out
      }
      const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      const multiply = (a, b) => {
        const out = new Array(16).fill(0)
        for (let column = 0; column < 4; column += 1) {
          for (let row = 0; row < 4; row += 1) {
            let sum = 0
            for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k]
            out[column * 4 + row] = sum
          }
        }
        return out
      }
      const quatMatrix = (x, y, z, w) => [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
      ]
      const nodeMatrix = (node) => {
        if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.slice()
        const translation = node.translation ?? [0, 0, 0]
        const rotation = node.rotation ?? [0, 0, 0, 1]
        const scale = node.scale ?? [1, 1, 1]
        const rotationMatrix = quatMatrix(rotation[0], rotation[1], rotation[2], rotation[3])
        const matrix = rotationMatrix.slice()
        for (let column = 0; column < 3; column += 1) {
          for (let row = 0; row < 3; row += 1) matrix[column * 4 + row] *= scale[column]
        }
        matrix[12] = translation[0]
        matrix[13] = translation[1]
        matrix[14] = translation[2]
        return matrix
      }
      const positions = []
      const normals = []
      let normalsComplete = true
      const nodes = json.nodes ?? []
      const sceneNodes = json.scenes?.[json.scene ?? 0]?.nodes
      const roots = Array.isArray(sceneNodes) ? sceneNodes : nodes.map((_, index) => index)
      const walk = (nodeIndex, parentMatrix) => {
        const node = nodes[nodeIndex]
        if (node === undefined) return
        const matrix = multiply(parentMatrix, nodeMatrix(node))
        if (node.mesh !== undefined && json.meshes?.[node.mesh] !== undefined) {
          for (const primitive of json.meshes[node.mesh].primitives ?? []) {
            if (primitive.mode !== undefined && primitive.mode !== 4) continue
            const positionAccessor = primitive.attributes?.POSITION
            if (positionAccessor === undefined) continue
            const sourcePositions = accessorNumbers(positionAccessor)
            const sourceNormals = primitive.attributes?.NORMAL !== undefined
              ? accessorNumbers(primitive.attributes.NORMAL)
              : null
            const indices = primitive.indices !== undefined ? accessorNumbers(primitive.indices) : null
            const vertexCount = sourcePositions.length / 3
            const triangleCount = indices === null ? Math.floor(vertexCount / 3) : Math.floor(indices.length / 3)
            for (let triangle = 0; triangle < triangleCount; triangle += 1) {
              const vertices = []
              let valid = true
              for (let corner = 0; corner < 3; corner += 1) {
                const vertex = indices === null ? triangle * 3 + corner : indices[triangle * 3 + corner]
                if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount) { valid = false; break }
                vertices.push(vertex)
              }
              if (!valid) continue
              for (const vertex of vertices) {
                const px = sourcePositions[vertex * 3]
                const py = sourcePositions[vertex * 3 + 1]
                const pz = sourcePositions[vertex * 3 + 2]
                positions.push(
                  matrix[0] * px + matrix[4] * py + matrix[8] * pz + matrix[12],
                  matrix[1] * px + matrix[5] * py + matrix[9] * pz + matrix[13],
                  matrix[2] * px + matrix[6] * py + matrix[10] * pz + matrix[14],
                )
                if (sourceNormals !== null && sourceNormals.length >= (vertex + 1) * 3) {
                  const nx = sourceNormals[vertex * 3]
                  const ny = sourceNormals[vertex * 3 + 1]
                  const nz = sourceNormals[vertex * 3 + 2]
                  normals.push(
                    matrix[0] * nx + matrix[4] * ny + matrix[8] * nz,
                    matrix[1] * nx + matrix[5] * ny + matrix[9] * nz,
                    matrix[2] * nx + matrix[6] * ny + matrix[10] * nz,
                  )
                } else {
                  normalsComplete = false
                  normals.push(0, 0, 0)
                }
              }
            }
          }
        }
        for (const child of node.children ?? []) walk(child, matrix)
      }
      for (const root of roots) walk(root, identity)
      return { positions, normals: normalsComplete && normals.length === positions.length ? normals : null }
    }

    /**
     * Detect the model format and parse it into a normalized mesh.
     * @param {string} fileName - uploaded file name.
     * @param {ArrayBuffer} buffer - uploaded bytes.
     * @returns {Promise<{ name: string, positions: Float32Array, normals: Float32Array, triangles: number, minY: number, maxY: number }>} the mesh.
     */
    async function parseModelFile(fileName, buffer) {
      const lower = fileName.toLowerCase()
      let raw
      if (lower.endsWith('.obj')) {
        raw = parseObjMesh(new TextDecoder().decode(buffer))
      } else if (lower.endsWith('.stl')) {
        raw = parseStlMesh(buffer)
      } else if (lower.endsWith('.glb')) {
        raw = parseGlbMesh(buffer)
      } else {
        throw new Error('Unsupported model format. Load a .glb, .obj or .stl file.')
      }
      const mesh = buildMesh(raw.positions, raw.normals)
      const segmentation = analyzeMesh(mesh.positions)
      const occlusion = bakeAmbientOcclusion(mesh.positions, mesh.normals)
      return {
        name: fileName,
        positions: mesh.positions,
        normals: mesh.normals,
        ao: occlusion,
        triangles: mesh.triangles,
        minY: mesh.minY,
        maxY: mesh.maxY,
        partIndex: segmentation.partIndex,
        parts: segmentation.parts,
        analysis: segmentation.analysis,
      }
    }
    // #endregion mesh-parsers

    /**
     * The sandboxed renderer document. It only ever talks to the parent through
     * postMessage, so generated code never reaches the harness page's origin.
     */
    const RENDER_DOC = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: #05060a; overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<canvas id="stage"></canvas>
<script>
(function () {
  var stage = document.getElementById('stage');
  var stageCtx = stage.getContext('2d');
  var running = false;

  function post(message) {
    try { parent.postMessage(message, '*'); } catch (error) { /* parent gone */ }
  }

  function sanitizeGlsl(source) {
    var text = String(source);
    text = text.replace(/#version[^\n]*\n?/g, '');
    text = text.replace(/#extension[^\n]*\n?/g, '');
    text = text.replace(/^\s*precision[^\n]*;\s*$/gm, '');
    text = text.replace(/^\s*uniform\s+(?:highp|mediump|lowp)?\s*vec2\s+u_resolution\s*;\s*$/gm, '');
    text = text.replace(/^\s*uniform\s+(?:highp|mediump|lowp)?\s*float\s+u_time\s*;\s*$/gm, '');
    text = text.replace(/^\s*uniform\s+(?:highp|mediump|lowp)?\s*float\s+u_duration\s*;\s*$/gm, '');
    text = text.replace(/\biResolution\b/g, 'u_resolution');
    text = text.replace(/\biTime\b/g, 'u_time');
    return text;
  }

  function compile3d(source, width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var gl = canvas.getContext('webgl', {
      alpha: false, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance'
    }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL is unavailable in this browser.');
    var body = sanitizeGlsl(source);
    var hasMain = /void\s+main\s*\(/.test(body);
    if (!hasMain && /mainImage\s*\(/.test(body)) {
      body += '\nvoid main() { vec4 nvsColor; mainImage(nvsColor, gl_FragCoord.xy); gl_FragColor = nvsColor; }\n';
      hasMain = true;
    }
    if (!hasMain) throw new Error('The shader defines no void main().');
    var vertexSource = 'attribute vec2 a_position; void main() { gl_Position = vec4(a_position, 0.0, 1.0); }';
    var fragmentSource = 'precision highp float;\nuniform vec2 u_resolution;\nuniform float u_time;\nuniform float u_duration;\n' + body;
    function makeShader(type, sourceText) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, sourceText);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(shader) || 'shader compilation failed';
        gl.deleteShader(shader);
        throw new Error('GLSL: ' + log);
      }
      return shader;
    }
    var program = gl.createProgram();
    gl.attachShader(program, makeShader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, makeShader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('GLSL link: ' + (gl.getProgramInfoLog(program) || 'link failed'));
    }
    gl.useProgram(program);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    var timeLocation = gl.getUniformLocation(program, 'u_time');
    var durationLocation = gl.getUniformLocation(program, 'u_duration');
    var resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    gl.uniform2f(resolutionLocation, width, height);
    return function draw(t, duration) {
      gl.viewport(0, 0, width, height);
      gl.uniform1f(timeLocation, t);
      gl.uniform1f(durationLocation, duration);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      stageCtx.drawImage(canvas, 0, 0, width, height);
    };
  }

  function compile2d(source) {
    // Accept both shapes a model produces: the complete "function draw(...) {}"
    // declaration, or only its body statements. The appended call fires only
    // when the declaration form was returned.
    var run = new Function(
      'ctx', 'W', 'H', 't', 'duration',
      source + '\n;if (typeof draw === "function") { draw(ctx, W, H, t, duration); }'
    );
    return function draw(t, duration) {
      stageCtx.save();
      stageCtx.setTransform(1, 0, 0, 1, 0, 0);
      stageCtx.globalAlpha = 1;
      stageCtx.globalCompositeOperation = 'source-over';
      stageCtx.fillStyle = '#05060a';
      stageCtx.fillRect(0, 0, stage.width, stage.height);
      try {
        run(stageCtx, stage.width, stage.height, t, duration);
      } finally {
        stageCtx.restore();
      }
    };
  }

  // ---------- uploaded 3D model pipeline ----------

  function identityMatrix() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  function multiplyMatrices(a, b) {
    var out = new Array(16);
    for (var column = 0; column < 4; column += 1) {
      for (var row = 0; row < 4; row += 1) {
        var sum = 0;
        for (var k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
        out[column * 4 + row] = sum;
      }
    }
    return out;
  }

  function perspectiveMatrix(fov, aspect, near, far) {
    var f = 1 / Math.tan(fov / 2);
    var nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }

  function normalize3(x, y, z) {
    var length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  }

  function lookAtMatrix(eye, center, up) {
    var z = normalize3(eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]);
    var x = normalize3(
      up[1] * z[2] - up[2] * z[1],
      up[2] * z[0] - up[0] * z[2],
      up[0] * z[1] - up[1] * z[0],
    );
    var y = [
      z[1] * x[2] - z[2] * x[1],
      z[2] * x[0] - z[0] * x[2],
      z[0] * x[1] - z[1] * x[0],
    ];
    return [
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
      -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
      -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
      1,
    ];
  }

  function modelMatrix(rotX, rotY, rotZ, scale, offsetY) {
    var cx = Math.cos(rotX), sx = Math.sin(rotX);
    var cy = Math.cos(rotY), sy = Math.sin(rotY);
    var cz = Math.cos(rotZ), sz = Math.sin(rotZ);
    var r00 = cz * cy;
    var r01 = cz * sy * sx - sz * cx;
    var r02 = cz * sy * cx + sz * sx;
    var r10 = sz * cy;
    var r11 = sz * sy * sx + cz * cx;
    var r12 = sz * sy * cx - cz * sx;
    var r20 = -sy;
    var r21 = cy * sx;
    var r22 = cy * cx;
    return [
      r00 * scale, r10 * scale, r20 * scale, 0,
      r01 * scale, r11 * scale, r21 * scale, 0,
      r02 * scale, r12 * scale, r22 * scale, 0,
      0, offsetY, 0, 1,
    ];
  }

  function normalMatrix(rotX, rotY, rotZ) {
    var cx = Math.cos(rotX), sx = Math.sin(rotX);
    var cy = Math.cos(rotY), sy = Math.sin(rotY);
    var cz = Math.cos(rotZ), sz = Math.sin(rotZ);
    var r00 = cz * cy;
    var r01 = cz * sy * sx - sz * cx;
    var r02 = cz * sy * cx + sz * sx;
    var r10 = sz * cy;
    var r11 = sz * sy * sx + cz * cx;
    var r12 = sz * sy * cx - cz * sx;
    var r20 = -sy;
    var r21 = cy * sx;
    var r22 = cy * cx;
    return [r00, r10, r20, r01, r11, r21, r02, r12, r22];
  }

  function partTransformMatrix(center, rotX, rotY, rotZ, offset) {
    var rotation = modelMatrix(rotX, rotY, rotZ, 1, 0);
    var cx = center[0];
    var cy = center[1];
    var cz = center[2];
    rotation[12] = cx + offset[0] - (rotation[0] * cx + rotation[4] * cy + rotation[8] * cz);
    rotation[13] = cy + offset[1] - (rotation[1] * cx + rotation[5] * cy + rotation[9] * cz);
    rotation[14] = cz + offset[2] - (rotation[2] * cx + rotation[6] * cy + rotation[10] * cz);
    return rotation;
  }

  function meshControls(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    function pick(value, fallback, min, max) {
      var number = Number(value);
      return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    }
    var tint = Array.isArray(source.tint) && source.tint.length >= 3 ? source.tint : null;
    var parts = [];
    if (Array.isArray(source.parts)) {
      for (var index = 0; index < Math.min(8, source.parts.length); index += 1) {
        var part = source.parts[index];
        if (!part || typeof part !== 'object') continue;
        parts.push({
          i: pick(part.i, index, 0, 7),
          rx: pick(part.rx, 0, -3.2, 3.2),
          ry: pick(part.ry, 0, -3.2, 3.2),
          rz: pick(part.rz, 0, -3.2, 3.2),
          ox: pick(part.ox, 0, -1, 1),
          oy: pick(part.oy, 0, -1, 1),
          oz: pick(part.oz, 0, -1, 1),
        });
      }
    }
    return {
      rotX: pick(source.rotX, 0, -12, 12),
      rotY: pick(source.rotY, 0, -12, 12),
      rotZ: pick(source.rotZ, 0, -12, 12),
      scale: pick(source.scale, 1, 0.2, 4),
      offsetY: pick(source.offsetY, 0, -1, 1),
      camRadius: pick(source.camRadius, 3.4, 1.6, 12),
      camAngle: pick(source.camAngle, 0.4, -20, 20),
      camHeight: pick(source.camHeight, 1.1, -2, 4),
      camFov: pick(source.camFov, 0.9, 0.5, 1.6),
      targetY: pick(source.targetY, 0, -1, 1),
      lightAz: pick(source.lightAz, 0.8, -20, 20),
      lightEl: pick(source.lightEl, 0.7, -1.5, 1.5),
      lightPower: pick(source.lightPower, 1.2, 0.5, 3),
      roughness: pick(source.roughness, 0.38, 0.05, 1),
      metalness: pick(source.metalness, 0.2, 0, 1),
      rim: pick(source.rim, 0.5, 0, 1),
      fog: pick(source.fog, 0.2, 0, 1),
      explode: pick(source.explode, 0, 0, 0.25),
      wobble: pick(source.wobble, 0, 0, 0.03),
      growth: pick(source.growth, 1, 0, 1),
      tint: tint === null ? [0.62, 0.66, 0.72] : [
        pick(tint[0], 0.62, 0, 1), pick(tint[1], 0.66, 0, 1), pick(tint[2], 0.72, 0, 1),
      ],
      parts: parts,
    };
  }

  function meshAnimation(source) {
    var run = new Function('t', 'duration', source + '\n;if (typeof animate === "function") { return animate(t, duration); }');
    return function (t, duration) {
      return run(t, duration);
    };
  }

  function compileMeshView(mesh, width, height, factor) {
    var scale = factor || 1;
    var internalWidth = Math.max(2, Math.round(width * scale));
    var internalHeight = Math.max(2, Math.round(height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = internalWidth;
    canvas.height = internalHeight;
    var gl = canvas.getContext('webgl', {
      alpha: true, antialias: true, premultipliedAlpha: false,
      preserveDrawingBuffer: true, powerPreference: 'high-performance',
    }) || canvas.getContext('experimental-webgl', { alpha: true, antialias: true });
    if (!gl) throw new Error('WebGL is unavailable, so the loaded 3D model cannot be rendered.');

    var vertexSource = [
      'attribute vec3 a_position;',
      'attribute vec3 a_normal;',
      'attribute float a_part;',
      'attribute float a_ao;',
      'uniform mat4 u_mvp;',
      'uniform mat4 u_model;',
      'uniform mat3 u_normalMatrix;',
      'uniform mat4 u_part0;',
      'uniform mat4 u_part1;',
      'uniform mat4 u_part2;',
      'uniform mat4 u_part3;',
      'uniform mat4 u_part4;',
      'uniform mat4 u_part5;',
      'uniform mat4 u_part6;',
      'uniform mat4 u_part7;',
      'uniform float u_time;',
      'uniform float u_explode;',
      'uniform float u_wobble;',
      'uniform float u_growth;',
      'uniform float u_minY;',
      'uniform float u_maxY;',
      'varying vec3 v_normal;',
      'varying vec3 v_world;',
      'varying vec3 v_local;',
      'varying float v_ao;',
      'mat4 partTransform() {',
      '  int index = int(a_part + 0.5);',
      '  if (index == 0) return u_part0;',
      '  if (index == 1) return u_part1;',
      '  if (index == 2) return u_part2;',
      '  if (index == 3) return u_part3;',
      '  if (index == 4) return u_part4;',
      '  if (index == 5) return u_part5;',
      '  if (index == 6) return u_part6;',
      '  return u_part7;',
      '}',
      'void main() {',
      '  vec3 p = a_position;',
      '  float growth = clamp(u_growth, 0.0, 1.0);',
      '  p.y = u_minY + (p.y - u_minY) * growth;',
      '  float wobble = sin(u_time * 2.2 + p.y * 3.7 + p.x * 2.9) * u_wobble;',
      '  p += normalize(a_normal + vec3(0.0001)) * (u_explode + wobble);',
      '  mat4 part = partTransform();',
      '  vec4 local = part * vec4(p, 1.0);',
      '  vec4 world = u_model * local;',
      '  v_world = world.xyz;',
      '  v_local = p;',
      '  v_normal = normalize(u_normalMatrix * (mat3(part) * a_normal));',
      '  v_ao = a_ao;',
      '  gl_Position = u_mvp * local;',
      '}',
    ].join('\n');

    var fragmentSource = [
      'precision highp float;',
      'uniform vec3 u_eye;',
      'uniform vec3 u_lightDir;',
      'uniform float u_lightPower;',
      'uniform float u_roughness;',
      'uniform float u_metalness;',
      'uniform float u_rim;',
      'uniform float u_fog;',
      'uniform vec3 u_tint;',
      'varying vec3 v_normal;',
      'varying vec3 v_world;',
      'varying vec3 v_local;',
      'varying float v_ao;',
      'vec3 aces(vec3 x) {',
      '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
      '}',
      'vec3 envColor(vec3 direction) {',
      '  float up = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);',
      '  vec3 sky = mix(vec3(0.03, 0.04, 0.06), vec3(0.36, 0.46, 0.62), up);',
      '  float sun = pow(max(dot(direction, normalize(u_lightDir)), 0.0), 180.0);',
      '  return sky + vec3(1.0, 0.9, 0.75) * sun * 1.6;',
      '}',
      'void main() {',
      '  vec3 N = normalize(v_normal);',
      '  vec3 V = normalize(u_eye - v_world);',
      '  vec3 L = normalize(u_lightDir);',
      '  vec3 H = normalize(L + V);',
      '  float NdL = max(dot(N, L), 0.0);',
      '  float NdV = max(dot(N, V), 0.0);',
      '  float NdH = max(dot(N, H), 0.0);',
      '  float a = max(u_roughness * u_roughness, 0.002);',
      '  float a2 = a * a;',
      '  float d = a2 / (3.14159265 * pow(NdH * NdH * (a2 - 1.0) + 1.0, 2.0));',
      '  float k = a * 0.5;',
      '  float vis = 0.25 / ((NdL * (1.0 - k) + k) * (NdV * (1.0 - k) + k) + 0.0001);',
      '  vec3 F0 = mix(vec3(0.04), u_tint, u_metalness);',
      '  vec3 F = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);',
      '  vec3 spec = d * vis * F * NdL * u_lightPower;',
      '  float patina = 0.5 + 0.5 * sin(v_local.x * 8.0) * sin(v_local.y * 11.0) * sin(v_local.z * 7.0);',
      '  vec3 diffuse = u_tint * (1.0 - u_metalness) * NdL * u_lightPower * (0.75 + 0.25 * patina);',
      '  float ao = clamp(v_ao, 0.0, 1.0);',
      '  diffuse *= mix(0.45, 1.0, ao);',
      '  vec3 fillDir = normalize(vec3(-u_lightDir.x, 0.35, -u_lightDir.z));',
      '  float fill = max(dot(N, fillDir), 0.0) * 0.35;',
      '  vec3 ambient = mix(vec3(0.04, 0.045, 0.06), vec3(0.30, 0.40, 0.55), N.y * 0.5 + 0.5);',
      '  ambient *= (0.45 + 0.55 * u_lightPower * 0.25) * mix(0.30, 1.0, ao);',
      '  vec3 color = ambient * u_tint * (1.0 - u_metalness) + diffuse + spec + u_tint * fill * 0.25;',
      '  vec3 env = envColor(reflect(-V, N));',
      '  vec3 F2 = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);',
      '  color += env * F2 * mix(0.2, 1.0, u_metalness) * (1.0 - u_roughness * 0.5) * 0.5;',
      '  color += u_rim * pow(1.0 - NdV, 3.0) * vec3(0.55, 0.75, 1.0) * 0.7;',
      '  float distance = length(u_eye - v_world);',
      '  color = mix(color, vec3(0.02, 0.03, 0.05), clamp((distance - 2.5) * u_fog * 0.25, 0.0, 0.85));',
      '  gl_FragColor = vec4(pow(aces(color), vec3(1.0 / 2.2)), 1.0);',
      '}',
    ].join('\n');

    function makeShader(type, sourceText) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, sourceText);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error('Model shader: ' + (gl.getShaderInfoLog(shader) || 'compilation failed'));
      }
      return shader;
    }

    var program = gl.createProgram();
    gl.attachShader(program, makeShader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, makeShader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Model shader: ' + (gl.getProgramInfoLog(program) || 'link failed'));
    }
    gl.useProgram(program);

    var positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    var normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    var partBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, partBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.partIndex, gl.STATIC_DRAW);
    var aoBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, aoBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.ao, gl.STATIC_DRAW);
    var positionLocation = gl.getAttribLocation(program, 'a_position');
    var normalLocation = gl.getAttribLocation(program, 'a_normal');
    var partLocation = gl.getAttribLocation(program, 'a_part');
    var aoLocation = gl.getAttribLocation(program, 'a_ao');
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(normalLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(partLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, partBuffer);
    gl.vertexAttribPointer(partLocation, 1, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aoLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, aoBuffer);
    gl.vertexAttribPointer(aoLocation, 1, gl.FLOAT, false, 0, 0);

    var uniforms = {};
    var names = [
      'u_mvp', 'u_model', 'u_normalMatrix', 'u_time', 'u_explode', 'u_wobble', 'u_growth',
      'u_minY', 'u_maxY', 'u_eye', 'u_lightDir', 'u_lightPower', 'u_roughness', 'u_metalness',
      'u_rim', 'u_fog', 'u_tint',
      'u_part0', 'u_part1', 'u_part2', 'u_part3', 'u_part4', 'u_part5', 'u_part6', 'u_part7',
    ];
    for (var i = 0; i < names.length; i += 1) uniforms[names[i]] = gl.getUniformLocation(program, names[i]);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    var vertexCount = mesh.positions.length / 3;

    return function drawMesh(controls, time) {
      gl.viewport(0, 0, internalWidth, internalHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      var eye = [
        Math.sin(controls.camAngle) * controls.camRadius,
        controls.camHeight,
        Math.cos(controls.camAngle) * controls.camRadius,
      ];
      var target = [0, controls.targetY, 0];
      var projection = perspectiveMatrix(controls.camFov, internalWidth / internalHeight, 0.05, 80);
      var view = lookAtMatrix(eye, target, [0, 1, 0]);
      var model = modelMatrix(controls.rotX, controls.rotY, controls.rotZ, controls.scale, controls.offsetY);
      var mvp = multiplyMatrices(projection, multiplyMatrices(view, model));
      var light = [
        Math.cos(controls.lightEl) * Math.sin(controls.lightAz),
        Math.sin(controls.lightEl),
        Math.cos(controls.lightEl) * Math.cos(controls.lightAz),
      ];
      gl.uniformMatrix4fv(uniforms.u_mvp, false, new Float32Array(mvp));
      gl.uniformMatrix4fv(uniforms.u_model, false, new Float32Array(model));
      gl.uniformMatrix3fv(uniforms.u_normalMatrix, false, new Float32Array(normalMatrix(controls.rotX, controls.rotY, controls.rotZ)));
      gl.uniform1f(uniforms.u_time, time);
      gl.uniform1f(uniforms.u_explode, controls.explode);
      gl.uniform1f(uniforms.u_wobble, controls.wobble);
      gl.uniform1f(uniforms.u_growth, controls.growth);
      gl.uniform1f(uniforms.u_minY, mesh.minY);
      gl.uniform1f(uniforms.u_maxY, mesh.maxY);
      gl.uniform3f(uniforms.u_eye, eye[0], eye[1], eye[2]);
      gl.uniform3f(uniforms.u_lightDir, light[0], light[1], light[2]);
      gl.uniform1f(uniforms.u_lightPower, controls.lightPower);
      gl.uniform1f(uniforms.u_roughness, controls.roughness);
      gl.uniform1f(uniforms.u_metalness, controls.metalness);
      gl.uniform1f(uniforms.u_rim, controls.rim);
      gl.uniform1f(uniforms.u_fog, controls.fog);
      gl.uniform3f(uniforms.u_tint, controls.tint[0], controls.tint[1], controls.tint[2]);
      var partMatrices = [];
      for (var partSlot = 0; partSlot < 8; partSlot += 1) partMatrices.push(identityMatrix());
      for (var item = 0; item < controls.parts.length; item += 1) {
        var entry = controls.parts[item];
        var center = (mesh.parts && mesh.parts[entry.i]) || [0, 0, 0];
        partMatrices[entry.i] = partTransformMatrix(center, entry.rx, entry.ry, entry.rz, [entry.ox, entry.oy, entry.oz]);
      }
      for (var slot = 0; slot < 8; slot += 1) {
        gl.uniformMatrix4fv(uniforms['u_part' + slot], false, new Float32Array(partMatrices[slot]));
      }
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
      return canvas;
    };
  }

  function drawMeshFrame(ctx, width, height, meshView, controls, time) {
    var warmth = 0.5 + 0.5 * Math.sin(controls.lightAz);
    var sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, 'rgb(' + Math.round(9 + 10 * warmth) + ',' + Math.round(12 + 8 * warmth) + ',' + Math.round(20 + 6 * warmth) + ')');
    sky.addColorStop(0.58, 'rgb(8, 10, 15)');
    sky.addColorStop(1, 'rgb(3, 4, 7)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    var glowX = width * (0.5 + 0.3 * Math.sin(controls.lightAz));
    var glowY = height * (0.34 - 0.18 * controls.lightEl);
    var glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, Math.max(width, height) * 0.6);
    glow.addColorStop(0, 'rgba(120,158,215,' + (0.08 + 0.05 * controls.lightPower).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    var horizon = height * 0.72;
    var ground = ctx.createLinearGradient(0, horizon, 0, height);
    ground.addColorStop(0, 'rgba(17,19,25,1)');
    ground.addColorStop(1, 'rgba(4,5,8,1)');
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, width, height - horizon);
    ctx.save();
    ctx.translate(width * 0.5, horizon + height * 0.035);
    ctx.scale(1, 0.22);
    var shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 0.3);
    shadow.addColorStop(0, 'rgba(0,0,0,0.8)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, width * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.drawImage(meshView(controls, time), 0, 0, width, height);

    var vignette = ctx.createRadialGradient(width * 0.5, height * 0.48, Math.min(width, height) * 0.35, width * 0.5, height * 0.5, Math.max(width, height) * 0.78);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    var frame = Math.floor(time * 24);
    ctx.save();
    ctx.globalAlpha = 0.045;
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < 240; i += 1) {
      var gx = ((Math.sin(i * 12.9898 + frame * 78.233) * 43758.5453) % 1 + 1) % 1 * width;
      var gy = ((Math.sin(i * 93.989 + frame * 12.345) * 24634.6345) % 1 + 1) % 1 * height;
      ctx.fillRect(gx, gy, 1, 1);
    }
    ctx.restore();
  }

  function pickMime(withSound) {
    var candidates = withSound
      ? [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ]
      : [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
    if (typeof MediaRecorder === 'undefined') return '';
    for (var i = 0; i < candidates.length; i += 1) {
      try { if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i]; } catch (error) { /* keep looking */ }
    }
    return '';
  }

  function renderTrack(OfflineCtor, track) {
    var sampleRate = 48000;
    var context = new OfflineCtor(2, Math.ceil(sampleRate * track.durationSec), sampleRate);
    var build = new Function('ctx', 'duration', track.code + '\n;if (typeof soundtrack === "function") { soundtrack(ctx, duration); }');
    build(context, track.durationSec);
    return context.startRendering();
  }

  function buildSoundtrack(tracks, totalDuration) {
    var OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtor) return Promise.reject(new Error('Web Audio is unavailable'));
    var sampleRate = 48000;
    var chain = Promise.resolve();
    var rendered = [];
    tracks.forEach(function (track) {
      chain = chain.then(function () {
        return renderTrack(OfflineCtor, track).then(function (buffer) { rendered.push(buffer); });
      });
    });
    return chain.then(function () {
      var totalSamples = Math.max(1, Math.ceil(sampleRate * totalDuration));
      var mixed;
      if (typeof window.AudioBuffer === 'function') {
        mixed = new window.AudioBuffer({ length: totalSamples, numberOfChannels: 2, sampleRate: sampleRate });
      } else {
        var holder = new OfflineCtor(2, totalSamples, sampleRate);
        mixed = holder.createBuffer(2, totalSamples, sampleRate);
      }
      var offset = 0;
      for (var index = 0; index < rendered.length; index += 1) {
        var buffer = rendered[index];
        var copy = Math.min(buffer.length, totalSamples - offset);
        for (var channel = 0; channel < 2; channel += 1) {
          var source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
          mixed.getChannelData(channel).set(source.subarray(0, copy), offset);
        }
        offset += buffer.length;
        if (offset >= totalSamples) break;
      }
      return mixed;
    });
  }

  function encodeWav(buffer) {
    var channels = [];
    for (var channel = 0; channel < buffer.numberOfChannels; channel += 1) channels.push(buffer.getChannelData(channel));
    var length = buffer.length;
    var dataSize = length * channels.length * 2;
    var output = new ArrayBuffer(44 + dataSize);
    var view = new DataView(output);
    function writeText(offset, text) {
      for (var index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
    }
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels.length, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels.length * 2, true);
    view.setUint16(32, channels.length * 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, dataSize, true);
    var offset = 44;
    for (var sample = 0; sample < length; sample += 1) {
      for (var channel = 0; channel < channels.length; channel += 1) {
        var value = Math.max(-1, Math.min(1, channels[channel][sample]));
        view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([output], { type: 'audio/wav' });
  }

  function createAudioHandle(buffer) {
    var AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    var context = new AudioCtor();
    var destination = context.createMediaStreamDestination();
    var source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    return { context: context, destination: destination, source: source };
  }

  function stopAudio(handle) {
    if (!handle) return;
    try { handle.source.stop(); } catch (error) { /* already stopped */ }
    try { handle.context.close(); } catch (error) { /* already closed */ }
  }

  function showAudioGate(onAllow, onSkip) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;text-align:center;background:rgba(5,6,10,0.86);color:#e8f2ff;font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif';
    var title = document.createElement('div');
    title.textContent = 'Звук / Audio';
    title.style.cssText = 'font-size:16px;font-weight:600';
    var note = document.createElement('div');
    note.textContent = 'Браузер ждёт действия, чтобы включить звук. / The browser needs one click to enable audio.';
    note.style.cssText = 'max-width:420px;color:#a9bad0';
    function button(label, primary) {
      var element = document.createElement('button');
      element.textContent = label;
      element.style.cssText = 'appearance:none;border:1px solid ' + (primary ? '#7cc4ff' : '#3a4557') + ';background:' + (primary ? 'rgba(40,110,180,0.35)' : 'transparent') + ';color:#e8f2ff;border-radius:8px;padding:8px 16px;font:inherit;cursor:pointer';
      return element;
    }
    var allow = button('Начать со звуком / With sound', true);
    allow.onclick = function () { overlay.remove(); onAllow(); };
    var skip = button('Без звука / Silent');
    skip.onclick = function () { overlay.remove(); onSkip(); };
    overlay.append(title, note, allow, skip);
    document.body.append(overlay);
    return overlay;
  }

  // ---------- deterministic offline encoding (WebCodecs + WebM) ----------

  function ivint(value) {
    for (var length = 1; length <= 8; length += 1) {
      if (value < Math.pow(2, 7 * length) - 1) return length;
    }
    return 8;
  }

  function vintBytes(value) {
    var length = ivint(value);
    var bytes = new Uint8Array(length);
    var rest = value;
    for (var index = length - 1; index >= 0; index -= 1) {
      bytes[index] = rest % 256;
      rest = Math.floor(rest / 256);
    }
    bytes[0] |= 1 << (8 - length);
    return bytes;
  }

  function uintBytes(value) {
    var bytes = [];
    var rest = Math.max(0, Math.round(value));
    while (rest > 0) {
      bytes.unshift(rest % 256);
      rest = Math.floor(rest / 256);
    }
    if (bytes.length === 0) bytes.push(0);
    return new Uint8Array(bytes);
  }

  function floatBytes(value) {
    var buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, false);
    return new Uint8Array(buffer);
  }

  function textBytes(text) {
    var bytes = new Uint8Array(text.length);
    for (var index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
    return bytes;
  }

  function joinParts(parts) {
    var total = 0;
    for (var index = 0; index < parts.length; index += 1) total += parts[index].length;
    var output = new Uint8Array(total);
    var offset = 0;
    for (var part = 0; part < parts.length; part += 1) {
      output.set(parts[part], offset);
      offset += parts[part].length;
    }
    return output;
  }

  function ebmlElement(id, payload) {
    return joinParts([new Uint8Array(id), vintBytes(payload.length), payload]);
  }

  function ebmlMaster(id, parts) {
    return ebmlElement(id, joinParts(parts));
  }

  function simpleBlockBytes(track, relativeMs, keyframe, data) {
    var head = new Uint8Array(4);
    head[0] = track === 1 ? 0x81 : 0x82;
    var code = Math.max(-32768, Math.min(32767, relativeMs));
    head[1] = (code >> 8) & 0xff;
    head[2] = code & 0xff;
    head[3] = keyframe ? 0x80 : 0x00;
    return joinParts([head, data]);
  }

  function opusHeadBytes() {
    var head = new Uint8Array(19);
    head.set(textBytes('OpusHead'), 0);
    head[8] = 1;
    head[9] = 2;
    new DataView(head.buffer).setUint16(10, 312, true);
    new DataView(head.buffer).setUint32(12, 48000, true);
    return head;
  }

  function muxWebm(chunks, options) {
    var videoCodecId = textBytes('V_VP8');
    var defaultDuration = Math.round(1000000000 / options.fps);
    var videoTrack = ebmlMaster([0xae], [
      ebmlElement([0xd7], uintBytes(1)),
      ebmlElement([0x73, 0xc5], uintBytes(1)),
      ebmlElement([0x83], uintBytes(1)),
      ebmlElement([0x86], videoCodecId),
      ebmlElement([0x23, 0xe3, 0x83], uintBytes(defaultDuration)),
      ebmlMaster([0xe0], [
        ebmlElement([0xb0], uintBytes(options.width)),
        ebmlElement([0xba], uintBytes(options.height)),
      ]),
    ]);
    var trackParts = [videoTrack];
    if (options.hasAudio) {
      trackParts.push(ebmlMaster([0xae], [
        ebmlElement([0xd7], uintBytes(2)),
        ebmlElement([0x73, 0xc5], uintBytes(2)),
        ebmlElement([0x83], uintBytes(2)),
        ebmlElement([0x86], textBytes('A_OPUS')),
        ebmlElement([0x63, 0xa2], opusHeadBytes()),
        ebmlMaster([0xe1], [
          ebmlElement([0xb5], floatBytes(48000)),
          ebmlElement([0x9f], uintBytes(2)),
        ]),
      ]));
    }
    var info = ebmlMaster([0x15, 0x49, 0xa9, 0x66], [
      ebmlElement([0x2a, 0xd7, 0xb1], uintBytes(1000000)),
      ebmlElement([0x4d, 0x80], textBytes('dsh-neural-video-studio')),
      ebmlElement([0x57, 0x41], textBytes('dsh-neural-video-studio')),
      ebmlElement([0x44, 0x89], floatBytes(options.durationMs)),
    ]);
    var tracks = ebmlMaster([0x16, 0x54, 0xae, 0x6b], trackParts);
    var ordered = chunks.slice().sort(function (left, right) { return left.timestampMs - right.timestampMs; });
    var clusters = [];
    var current = null;
    for (var index = 0; index < ordered.length; index += 1) {
      var chunk = ordered[index];
      var timecode = Math.round(chunk.timestampMs);
      if (current === null || timecode - current.start >= 1000 || timecode < current.start) {
        current = { start: timecode, blocks: [] };
        clusters.push(current);
      }
      var relative = timecode - current.start;
      current.blocks.push(ebmlElement([0xa3], simpleBlockBytes(chunk.track, relative, chunk.key, chunk.data)));
    }
    var clusterParts = [];
    var payloadLength = info.length + tracks.length;
    for (var clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
      var cluster = clusters[clusterIndex];
      var bytes = ebmlMaster([0x1f, 0x43, 0xb6, 0x75], [ebmlElement([0xe7], uintBytes(cluster.start))].concat(cluster.blocks));
      clusterParts.push(bytes);
      payloadLength += bytes.length;
    }
    var header = ebmlMaster([0x1a, 0x45, 0xdf, 0xa3], [
      ebmlElement([0x42, 0x86], textBytes('webm')),
      ebmlElement([0x42, 0x87], uintBytes(4)),
      ebmlElement([0x42, 0x85], uintBytes(2)),
    ]);
    var segmentHeader = joinParts([new Uint8Array([0x18, 0x53, 0x80, 0x67]), vintBytes(payloadLength)]);
    return new Blob([header, segmentHeader, info, tracks].concat(clusterParts), { type: 'video/webm' });
  }

  function validateVideo(blob, expectedDuration) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var video = document.createElement('video');
      var settled = false;
      function finish(ok, message) {
        if (settled) return;
        settled = true;
        try { URL.revokeObjectURL(url); } catch (error) { /* ignore */ }
        if (ok) resolve();
        else reject(new Error(message));
      }
      var timer = setTimeout(function () { finish(false, 'the encoded clip did not load'); }, 6000);
      video.preload = 'metadata';
      video.muted = true;
      video.onloadedmetadata = function () {
        clearTimeout(timer);
        var duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) finish(false, 'the encoded clip has no duration');
        else if (Math.abs(duration - expectedDuration) > Math.max(2, expectedDuration * 0.2)) {
          finish(false, 'the encoded clip duration is ' + duration.toFixed(1) + 's');
        } else finish(true);
      };
      video.onerror = function () { clearTimeout(timer); finish(false, 'the encoded clip cannot be decoded'); };
      video.src = url;
    });
  }

  async function encodeOffline(job, drawAt, total, audioBuffer, width, height, fps, quality) {
    var EncoderCtor = window.VideoEncoder;
    var FrameCtor = window.VideoFrame;
    var AudioEncoderCtor = window.AudioEncoder;
    var AudioDataCtor = window.AudioData;
    if (!EncoderCtor || !FrameCtor) throw new Error('WebCodecs is unavailable');
    var factor = quality === 'high' ? 0.22 : quality === 'fast' ? 0.07 : 0.13;
    var bitrate = Math.round(Math.min(45000000, Math.max(2500000, width * height * fps * factor)));
    var config = { codec: 'vp8', width: width, height: height, bitrate: bitrate, framerate: fps, latencyMode: 'quality' };
    var support = await EncoderCtor.isConfigSupported(config);
    if (!support || support.supported !== true) throw new Error('VP8 encoding is unavailable');
    var videoChunks = [];
    var audioChunks = [];
    var failure = null;
    var videoEncoder = new EncoderCtor({
      output: function (chunk) {
        var bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        videoChunks.push({ track: 1, timestampMs: chunk.timestamp / 1000, data: bytes, key: chunk.type === 'key' });
      },
      error: function (error) { failure = error; },
    });
    videoEncoder.configure(config);
    var audioEncoder = null;
    if (audioBuffer !== null && AudioEncoderCtor && AudioDataCtor) {
      var audioConfig = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 };
      var audioSupport = await AudioEncoderCtor.isConfigSupported(audioConfig);
      if (audioSupport && audioSupport.supported === true) {
        audioEncoder = new AudioEncoderCtor({
          output: function (chunk) {
            var bytes = new Uint8Array(chunk.byteLength);
            chunk.copyTo(bytes);
            audioChunks.push({ track: 2, timestampMs: chunk.timestamp / 1000, data: bytes, key: true });
          },
          error: function (error) { failure = error; },
        });
        audioEncoder.configure(audioConfig);
        var left = audioBuffer.getChannelData(0);
        var right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
        var block = 48000;
        for (var start = 0; start < audioBuffer.length; start += block) {
          var frames = Math.min(block, audioBuffer.length - start);
          var planar = new Float32Array(frames * 2);
          for (var frame = 0; frame < frames; frame += 1) {
            planar[frame] = left[start + frame];
            planar[frames + frame] = right[start + frame];
          }
          var audioData = new AudioDataCtor({
            format: 'f32-planar', sampleRate: 48000, numberOfFrames: frames, numberOfChannels: 2,
            timestamp: Math.round((start / 48000) * 1000000), data: planar,
          });
          audioEncoder.encode(audioData);
          audioData.close();
        }
      }
    }
    var totalFrames = Math.max(1, Math.round(total * fps));
    for (var frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      if (failure !== null) throw failure;
      drawAt(frameIndex / fps);
      var frame = new FrameCtor(stage, {
        timestamp: Math.round((frameIndex / fps) * 1000000),
        duration: Math.round(1000000 / fps),
      });
      videoEncoder.encode(frame, { keyFrame: frameIndex === 0 || frameIndex % Math.round(fps * 2) === 0 });
      frame.close();
      if (frameIndex % 10 === 0) {
        post({ type: 'encodeProgress', frame: frameIndex, totalFrames: totalFrames });
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
      if (videoEncoder.encodeQueueSize > 6) {
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
    }
    await videoEncoder.flush();
    videoEncoder.close();
    if (audioEncoder !== null) await audioEncoder.flush();
    if (audioEncoder !== null) audioEncoder.close();
    if (failure !== null) throw failure;
    var blob = muxWebm(videoChunks.concat(audioChunks), {
      width: width, height: height, fps: fps,
      durationMs: Math.round(total * 1000),
      hasAudio: audioChunks.length > 0,
    });
    await validateVideo(blob, total);
    return { blob: blob, mimeType: 'video/webm', durationSec: total, sound: audioChunks.length > 0 };
  }

  // ---------- synthetic character voices (formant synthesis) ----------

  var VOICE_PRESETS = {
    male: { f0: 112, formant: 1.0, rate: 1.0, gain: 0.9 },
    female: { f0: 192, formant: 1.13, rate: 1.05, gain: 0.85 },
    child: { f0: 245, formant: 1.24, rate: 1.1, gain: 0.8 },
    robot: { f0: 92, formant: 0.95, rate: 0.9, gain: 0.95 },
    narrator: { f0: 132, formant: 1.0, rate: 0.92, gain: 1.0 },
  };
  var VOWEL_FORMANTS = {
    a: [760, 1150, 2450], e: [560, 1850, 2500], i: [300, 2280, 3010],
    o: [590, 880, 2430], u: [320, 880, 2250], y: [320, 1450, 2420],
  };

  function phonemeUnits(text) {
    var lower = String(text).toLowerCase();
    var units = [];
    var vowels = { 'а': 'a', 'е': 'e', 'ё': 'o', 'и': 'i', 'о': 'o', 'у': 'u', 'ы': 'y', 'э': 'e', 'ю': 'u', 'я': 'a', 'a': 'a', 'e': 'e', 'i': 'i', 'o': 'o', 'u': 'u', 'y': 'y' };
    var fricatives = 'сшхфщжзцчвfszhxcw';
    var plosives = 'пткбдгptkbdg';
    var nasals = 'мнmn';
    var liquids = 'лрlrv';
    for (var index = 0; index < lower.length; index += 1) {
      var letter = lower[index];
      if (vowels[letter] !== undefined) units.push({ kind: 'vowel', vowel: vowels[letter] });
      else if (fricatives.indexOf(letter) >= 0) units.push({ kind: 'fricative' });
      else if (plosives.indexOf(letter) >= 0) units.push({ kind: 'plosive' });
      else if (nasals.indexOf(letter) >= 0) units.push({ kind: 'nasal' });
      else if (liquids.indexOf(letter) >= 0) units.push({ kind: 'liquid' });
      else if (letter === ' ' || letter === ',' || letter === '.' || letter === '-' || letter === '!') units.push({ kind: 'pause' });
    }
    if (units.length === 0) units.push({ kind: 'vowel', vowel: 'a' });
    return units;
  }

  function renderVoiceLine(OfflineCtor, line) {
    var preset = VOICE_PRESETS[line.voice] || VOICE_PRESETS.narrator;
    var sampleRate = 48000;
    var duration = Math.max(0.4, Number(line.duration) || 2);
    var context = new OfflineCtor(2, Math.ceil(sampleRate * (duration + 0.3)), sampleRate);
    var units = phonemeUnits(line.text);
    var base = units.map(function (unit) {
      return unit.kind === 'vowel' ? 0.135 : unit.kind === 'pause' ? 0.08 : 0.065;
    });
    var baseTotal = base.reduce(function (sum, value) { return sum + value; }, 0);
    var scale = duration / Math.max(0.001, baseTotal);
    var noiseBuffer = context.createBuffer(1, sampleRate, sampleRate);
    var noise = noiseBuffer.getChannelData(0);
    for (var noiseIndex = 0; noiseIndex < noise.length; noiseIndex += 1) {
      noise[noiseIndex] = Math.sin(noiseIndex * 12.9898) * 43758.5453 % 1;
    }
    var master = context.createGain();
    master.gain.value = preset.gain;
    master.connect(context.destination);
    var cursor = 0.05;
    units.forEach(function (unit, unitIndex) {
      var unitDuration = base[unitIndex] * scale;
      var time = cursor;
      cursor += unitDuration;
      if (unit.kind === 'pause') return;
      if (unit.kind === 'vowel') {
        var formants = VOWEL_FORMANTS[unit.vowel] || VOWEL_FORMANTS.a;
        var source = context.createOscillator();
        source.type = 'sawtooth';
        source.frequency.value = preset.f0 * (0.94 + 0.12 * ((unitIndex % 3) / 3));
        var envelope = context.createGain();
        envelope.gain.setValueAtTime(0.0001, time);
        envelope.gain.exponentialRampToValueAtTime(0.55, time + 0.02);
        envelope.gain.setValueAtTime(0.55, time + unitDuration * 0.65);
        envelope.gain.exponentialRampToValueAtTime(0.0001, time + unitDuration);
        for (var formant = 0; formant < 3; formant += 1) {
          var filter = context.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.value = formants[formant] * preset.formant;
          filter.Q.value = 7 + formant * 3;
          var formantGain = context.createGain();
          formantGain.gain.value = formant === 0 ? 0.9 : formant === 1 ? 0.55 : 0.3;
          source.connect(filter);
          filter.connect(formantGain);
          formantGain.connect(envelope);
        }
        envelope.connect(master);
        source.start(time);
        source.stop(time + unitDuration + 0.02);
      } else if (unit.kind === 'fricative' || unit.kind === 'plosive') {
        var noiseSource = context.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        var noiseFilter = context.createBiquadFilter();
        noiseFilter.type = unit.kind === 'fricative' ? 'bandpass' : 'lowpass';
        noiseFilter.frequency.value = unit.kind === 'fricative' ? 3200 : 900;
        var noiseGain = context.createGain();
        var length = unit.kind === 'plosive' ? Math.min(0.05, unitDuration) : unitDuration;
        noiseGain.gain.setValueAtTime(0.0001, time);
        noiseGain.gain.exponentialRampToValueAtTime(unit.kind === 'fricative' ? 0.22 : 0.4, time + 0.012);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + length);
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(master);
        noiseSource.start(time);
        noiseSource.stop(time + length + 0.01);
      } else {
        var hum = context.createOscillator();
        hum.type = unit.kind === 'nasal' ? 'triangle' : 'sawtooth';
        hum.frequency.value = preset.f0 * 0.85;
        var humGain = context.createGain();
        var humEnvelope = context.createBiquadFilter();
        humEnvelope.type = 'lowpass';
        humEnvelope.frequency.value = unit.kind === 'nasal' ? 600 : 1200;
        humGain.gain.setValueAtTime(0.0001, time);
        humGain.gain.exponentialRampToValueAtTime(0.4, time + 0.02);
        humGain.gain.exponentialRampToValueAtTime(0.0001, time + unitDuration);
        hum.connect(humEnvelope);
        humEnvelope.connect(humGain);
        humGain.connect(master);
        hum.start(time);
        hum.stop(time + unitDuration + 0.02);
      }
    });
    return context.startRendering();
  }

  function buildVoiceTrack(dialog, totalDuration) {
    var lines = Array.isArray(dialog) ? dialog.filter(function (line) {
      return line && typeof line.text === 'string' && line.text.trim() !== '';
    }) : [];
    if (lines.length === 0) return Promise.resolve(null);
    var OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtor) return Promise.resolve(null);
    var sampleRate = 48000;
    var length = Math.max(1, Math.ceil(sampleRate * totalDuration));
    var mixed;
    if (typeof window.AudioBuffer === 'function') mixed = new window.AudioBuffer({ length: length, numberOfChannels: 2, sampleRate: sampleRate });
    else mixed = new OfflineCtor(2, length, sampleRate).createBuffer(2, length, sampleRate);
    var chain = Promise.resolve();
    lines.forEach(function (line) {
      chain = chain.then(function () {
        return renderVoiceLine(OfflineCtor, line).then(function (buffer) {
          var offset = Math.max(0, Math.floor((Number(line.at) || 0) * sampleRate));
          var copy = Math.min(buffer.length, length - offset);
          if (copy <= 0) return;
          for (var channel = 0; channel < 2; channel += 1) {
            var source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
            mixed.getChannelData(channel).set(source.subarray(0, copy), offset);
          }
        });
      });
    });
    return chain.then(function () { return mixed; });
  }

  function mixAudioTracks(buffers, totalDuration) {
    var OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var sampleRate = 48000;
    var length = Math.max(1, Math.ceil(sampleRate * totalDuration));
    var mixed;
    if (typeof window.AudioBuffer === 'function') mixed = new window.AudioBuffer({ length: length, numberOfChannels: 2, sampleRate: sampleRate });
    else mixed = new OfflineCtor(2, length, sampleRate).createBuffer(2, length, sampleRate);
    for (var bufferIndex = 0; bufferIndex < buffers.length; bufferIndex += 1) {
      var buffer = buffers[bufferIndex];
      if (!buffer) continue;
      var copy = Math.min(buffer.length, length);
      for (var channel = 0; channel < 2; channel += 1) {
        var target = mixed.getChannelData(channel);
        var source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
        for (var index = 0; index < copy; index += 1) {
          target[index] = Math.max(-1, Math.min(1, target[index] + source[index]));
        }
      }
    }
    return mixed;
  }

  function drawSubtitles(ctx, width, height, dialog, time) {
    var lines = Array.isArray(dialog) ? dialog : [];
    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index];
      var at = Number(line.at) || 0;
      var duration = Number(line.duration) || 2;
      if (time < at || time > at + duration) continue;
      var alpha = Math.min(1, (time - at) / 0.2, (at + duration - time) / 0.2);
      if (alpha <= 0) continue;
      var fontSize = Math.max(14, Math.round(height * 0.042));
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.font = '600 ' + fontSize + 'px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var text = String(line.text || '');
      var maxWidth = width * 0.82;
      var words = text.split(/\s+/);
      var rows = [];
      var row = '';
      for (var word = 0; word < words.length; word += 1) {
        var candidate = row === '' ? words[word] : row + ' ' + words[word];
        if (ctx.measureText(candidate).width > maxWidth && row !== '') {
          rows.push(row);
          row = words[word];
        } else row = candidate;
      }
      if (row !== '') rows.push(row);
      var lineHeight = Math.round(fontSize * 1.3);
      var blockHeight = rows.length * lineHeight;
      var centerY = height * 0.9 - blockHeight / 2;
      var widest = 0;
      for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        widest = Math.max(widest, ctx.measureText(rows[rowIndex]).width);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      var padding = fontSize * 0.5;
      var left = width / 2 - widest / 2 - padding;
      var top = centerY - lineHeight / 2 - padding * 0.6;
      var boxHeight = blockHeight + padding * 1.2;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(left, top, widest + padding * 2, boxHeight, fontSize * 0.3);
        ctx.fill();
      } else ctx.fillRect(left, top, widest + padding * 2, boxHeight);
      ctx.fillStyle = '#ffffff';
      for (var rowIndex2 = 0; rowIndex2 < rows.length; rowIndex2 += 1) {
        ctx.fillText(rows[rowIndex2], width / 2, centerY + rowIndex2 * lineHeight);
      }
      ctx.restore();
      return;
    }
  }

  async function buildFilmAudio(audioTracks, dialog, total) {
    var OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtor) return null;
    var soundtrack = null;
    var voice = null;
    if (Array.isArray(audioTracks) && audioTracks.length > 0) {
      var rendered = await buildSoundtrack(audioTracks, total);
      soundtrack = rendered;
    } else if (audioTracks !== null) {
      soundtrack = null;
    }
    if (Array.isArray(dialog) && dialog.length > 0) {
      voice = await buildVoiceTrack(dialog, total);
    }
    if (soundtrack === null && voice === null) return null;
    return mixAudioTracks([soundtrack, voice].filter(Boolean), total);
  }

  function start(job) {
    if (running) throw new Error('A render is already running.');
    var width = Math.max(2, Math.floor(job.width || 1280));
    var height = Math.max(2, Math.floor(job.height || 720));
    var fps = job.fps === 24 ? 24 : 30;
    var scenes = Array.isArray(job.scenes) ? job.scenes : [];
    if (scenes.length === 0) throw new Error('No scenes to render.');
    running = true;
    stage.width = width;
    stage.height = height;
    var meshView = null;
    function ensureMeshView() {
      if (!job.mesh || !job.mesh.positions || !job.mesh.normals) {
        throw new Error('A "mesh" scene needs a loaded 3D model. Load a .glb, .obj or .stl file in the studio panel.');
      }
      if (meshView === null) meshView = compileMeshView(job.mesh, width, height);
      return meshView;
    }
    var draws = [];
    for (var i = 0; i < scenes.length; i += 1) {
      var scene = scenes[i];
      if (scene.engine === 'mesh') {
        var animateToggle = meshAnimation(chap(scene.code));
        var meshDraw = ensureMeshView();
        draws.push((function (animate, drawMesh) {
          return function (t, duration) {
            var controls = meshControls(animate(t, duration));
            drawMeshFrame(stageCtx, stage.width, stage.height, drawMesh, controls, t);
          };
        })(animateToggle, meshDraw));
      } else if (scene.engine === '3d') {
        draws.push(compile3d(chap(scene.code), width, height));
      } else {
        draws.push(compile2d(chap(scene.code)));
      }
    }
    var durations = [];
    for (var j = 0; j < scenes.length; j += 1) durations.push(Math.max(0.4, Number(scenes[j].durationSec) || 3));
    var total = 0;
    for (var k = 0; k < durations.length; k += 1) total += durations[k];
    if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is unavailable in this browser.');
    var audioTracks = job.sound !== false && Array.isArray(job.audioTracks)
      ? job.audioTracks.filter(function (track) {
        return track && typeof track.code === 'string' && track.code.trim() !== '' && Number(track.durationSec) > 0;
      })
      : [];
    var wantSound = audioTracks.length > 0;
    var begun = false;
    var audioHandle = null;
    var settled = false;

    function tryRecorder(tracks, withSound) {
      var bitrate = Math.max(2000000, Math.round(width * height * fps * (withSound ? 0.14 : 0.12)));
      var mime = pickMime(withSound);
      try {
        return {
          recorder: new MediaRecorder(tracks, mime === '' ? { videoBitsPerSecond: bitrate } : { mimeType: mime, videoBitsPerSecond: bitrate }),
          mime: mime,
        };
      } catch (error) {
        try {
          return { recorder: new MediaRecorder(tracks, { videoBitsPerSecond: bitrate }), mime: '' };
        } catch (second) {
          return null;
        }
      }
    }

    function begin(handle) {
      if (begun) return;
      var videoStream = stage.captureStream(fps);
      var stream = new MediaStream();
      var videoTracks = videoStream.getVideoTracks();
      for (var v = 0; v < videoTracks.length; v += 1) stream.addTrack(videoTracks[v]);
      if (handle !== null) {
        var audioTracks = handle.destination.stream.getAudioTracks();
        for (var a = 0; a < audioTracks.length; a += 1) stream.addTrack(audioTracks[a]);
      }
      var created = tryRecorder(stream, handle !== null);
      if (created === null && handle !== null) {
        stopAudio(handle);
        handle = null;
        audioHandle = null;
        post({ type: 'warning', message: 'This browser cannot record audio with video; recording without sound.' });
        videoStream = stage.captureStream(fps);
        stream = new MediaStream();
        videoTracks = videoStream.getVideoTracks();
        for (v = 0; v < videoTracks.length; v += 1) stream.addTrack(videoTracks[v]);
        created = tryRecorder(stream, false);
      }
      if (created === null) {
        fail('MediaRecorder could not start in this browser.');
        return;
      }
      begun = true;
      audioHandle = handle;
      var mime = created.mime;
      var recorder = created.recorder;
      var chunks = [];
      var blobPromise = new Promise(function (resolve) {
        recorder.onstop = function () { resolve(new Blob(chunks, { type: mime || 'video/webm' })); };
      });
      recorder.ondataavailable = function (event) {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = function (event) {
        fail('Recording failed: ' + ((event && event.error && event.error.message) || 'MediaRecorder error'));
      };
      recorder.start(200);
      if (handle !== null) {
        try { handle.source.start(); } catch (error) { /* the clip records without sound */ }
      }
      var startedAt = performance.now();
      var lastScene = -1;
      var frame = 0;

      function stopTracks() {
        try {
          var tracks = stream.getTracks();
          for (var t = 0; t < tracks.length; t += 1) tracks[t].stop();
        } catch (error) { /* stream already gone */ }
      }

      function fail(message) {
        if (settled) return;
        settled = true;
        running = false;
        try { recorder.stop(); } catch (error) { /* already stopped */ }
        stopTracks();
        stopAudio(audioHandle);
        post({ type: 'error', message: message });
      }

      function finish() {
        if (settled) return;
        settled = true;
        running = false;
        try { recorder.stop(); } catch (error) { /* already stopped */ }
        blobPromise.then(function (blob) {
          stopTracks();
          stopAudio(audioHandle);
          audioHandle = null;
          post({
            type: 'done',
            blob: blob,
            mimeType: blob.type || mime || 'video/webm',
            durationSec: total,
            sound: handle !== null,
          });
        });
      }

      function tick() {
        var at = (performance.now() - startedAt) / 1000;
        if (at >= total) { finish(); return; }
        var acc = 0;
        var index = durations.length - 1;
        for (var s = 0; s < durations.length; s += 1) {
          if (at < acc + durations[s]) { index = s; break; }
          acc += durations[s];
        }
        var local = Math.max(0, at - acc);
        try {
          draws[index](local, durations[index]);
        } catch (error) {
          fail('Scene ' + (index + 1) + ' failed: ' + (error && error.message ? error.message : String(error)));
          return;
        }
        frame += 1;
        if (index !== lastScene) {
          lastScene = index;
          post({ type: 'scene', index: index, name: (scenes[index] && scenes[index].name) || '' });
        }
        if (frame % 6 === 0) post({ type: 'progress', elapsed: at, total: total });
        requestAnimationFrame(tick);
      }

      post({ type: 'started', total: total, mime: mime, sound: handle !== null });
      requestAnimationFrame(tick);
    }

    post({ type: 'audioBuilding', total: total, sound: wantSound });
    if (!wantSound) {
      begin(null);
      return;
    }
    buildSoundtrack(audioTracks, total).then(function (buffer) {
      post({ type: 'audioTrack', blob: encodeWav(buffer), durationSec: total, sampleRate: buffer.sampleRate });
      var handle = createAudioHandle(buffer);
      if (handle === null) {
        post({ type: 'warning', message: 'Web Audio is unavailable; recording without sound.' });
        begin(null);
        return;
      }
      function useAudio() {
        if (audioGateOverlay !== null) {
          audioGateOverlay.remove();
          audioGateOverlay = null;
        }
        if (begun) { stopAudio(handle); return; }
        begin(handle);
      }
      var audioGateOverlay = null;
      var gateOpen = false;
      var gateTimer = setTimeout(function () {
        if (!begun && !gateOpen && handle.context.state !== 'running') openGate();
      }, 900);
      function openGate() {
        if (gateOpen || begun) return;
        gateOpen = true;
        post({ type: 'audioGate' });
        audioGateOverlay = showAudioGate(
          function () {
            gateOpen = false;
            handle.context.resume().then(useAudio, function () { stopAudio(handle); begin(null); });
          },
          function () {
            gateOpen = false;
            stopAudio(handle);
            begin(null);
          },
        );
      }
      var resume = handle.context.resume();
      if (resume && typeof resume.then === 'function') {
        resume.then(function () {
          clearTimeout(gateTimer);
          if (handle.context.state === 'running') useAudio();
          else openGate();
        }, function () {
          clearTimeout(gateTimer);
          openGate();
        });
      } else if (handle.context.state === 'running') {
        clearTimeout(gateTimer);
        useAudio();
      } else {
        openGate();
      }
    }).catch(function (error) {
      post({
        type: 'warning',
        message: 'Soundtrack failed: ' + (error && error.message ? error.message : String(error)) + ' — recording without sound.',
      });
      begin(null);
    });
  }

  function chap(value) {
    return typeof value === 'string' ? value : '';
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'render') {
      try { start(data); } catch (error) {
        running = false;
        post({ type: 'error', message: error && error.message ? error.message : String(error) });
      }
    }
  });

  post({ type: 'ready' });
})();
</script>
</body>
</html>`

    /** Theme-token stylesheet; installed as one plugin-owned effect. */
    const CSS = `
.nvs-page { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font-size: 14px; line-height: 1.55; }
.nvs-scroll { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
.nvs-content { max-width: 1180px; margin: 0 auto; padding: 28px clamp(20px, 4vw, 48px) 48px; }
.nvs-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.nvs-title { margin: 0; font-size: 20px; line-height: 28px; font-weight: 500; }
.nvs-sub { margin: 6px 0 0; max-width: 62ch; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.nvs-model { white-space: nowrap; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 4px 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.nvs-model[data-ok='false'] { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.nvs-grid { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); gap: 16px; align-items: start; }
@media (max-width: 920px) { .nvs-grid { grid-template-columns: minmax(0, 1fr); } }
.nvs-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 16px; }
.nvs-card + .nvs-card { margin-top: 16px; }
.nvs-card-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.nvs-card-title { margin: 0; font-size: 14px; font-weight: 600; }
.nvs-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.nvs-field { display: block; margin-bottom: 14px; }
.nvs-label { display: block; margin-bottom: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
.nvs-textarea, .nvs-input, .nvs-select { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; }
.nvs-textarea { min-height: 92px; resize: vertical; }
.nvs-textarea:focus, .nvs-input:focus, .nvs-select:focus { border-color: var(--dsw-alias-brand-primary); }
.nvs-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.nvs-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.nvs-fields .nvs-field { margin-bottom: 0; }
.nvs-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-layer-2); }
.nvs-seg button { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; padding: 6px 14px; cursor: pointer; }
.nvs-seg button[aria-pressed='true'] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }
.nvs-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: -2px 0 14px; }
.nvs-chip { appearance: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 3px 10px; cursor: pointer; }
.nvs-chip[aria-pressed='true'] { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); }
.nvs-btn { appearance: none; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; padding: 7px 14px; cursor: pointer; text-decoration: none; }
.nvs-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.nvs-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.nvs-btn-primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); font-weight: 600; }
.nvs-btn-icon { padding: 4px 8px; font-size: 12px; line-height: 1.2; }
.nvs-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.nvs-shot { display: flex; align-items: flex-start; gap: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-1); }
.nvs-shot + .nvs-shot { margin-top: 8px; }
.nvs-shot[data-active='true'] { border-color: var(--dsw-alias-brand-primary); }
.nvs-shot-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; appearance: none; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; padding: 0; }
.nvs-shot-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nvs-shot-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.nvs-shot-tools { display: flex; gap: 4px; }
.nvs-scenes { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 8px; }
.nvs-scene-tab { appearance: none; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer; }
.nvs-scene-tab[aria-pressed='true'] { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); }
.nvs-code { width: 100%; box-sizing: border-box; min-height: 260px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; overflow: auto; resize: vertical; outline: none; }
.nvs-code:focus { border-color: var(--dsw-alias-brand-primary); }
.nvs-stage { position: relative; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: #05060a; aspect-ratio: 16 / 9; }
.nvs-stage iframe, .nvs-stage video { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; background: #05060a; }
.nvs-stage video { object-fit: contain; }
.nvs-stage-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; }
.nvs-progress { position: relative; height: 6px; margin: 12px 0 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.nvs-progress > span { display: block; height: 100%; background: var(--dsw-alias-brand-primary); transition: width 0.18s linear; }
.nvs-progress[data-indeterminate='true'] > span { width: 35%; animation: nvs-indeterminate 1.3s ease-in-out infinite; }
@keyframes nvs-indeterminate { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
.nvs-status { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-bottom: 10px; }
.nvs-error { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-2); font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.nvs-warning { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 8px; color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-layer-2); font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.nvs-footnote { margin: 12px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.nvs-empty { padding: 20px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.nvs-mesh-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 13px; }
.nvs-mesh-glyph { color: var(--dsw-alias-brand-primary); }
.nvs-mesh-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.nvs-log { display: flex; flex-direction: column; gap: 8px; max-height: 240px; overflow: auto; margin-bottom: 12px; padding-right: 4px; }
.nvs-log-row { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.nvs-log-row[data-role='user'] { align-self: flex-end; max-width: 92%; }
.nvs-log-row[data-role='assistant'] { align-self: flex-start; max-width: 96%; }
.nvs-log-role { color: var(--dsw-alias-label-secondary); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
.nvs-log-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.nvs-refine { display: flex; flex-direction: column; gap: 8px; }
.nvs-refine-input { min-height: 64px; }
.nvs-refine .nvs-btn { align-self: flex-start; }
`

    /** Read the persisted studio state, tolerating a stale or broken record. */
    function loadState() {
      const base = {
        prompt: '',
        mode: 'mixed',
        durationSec: 8,
        fps: 30,
        width: 1280,
        height: 720,
        style: '',
        shots: [],
        iterations: [],
        activeShot: 0,
        activeScene: 0,
        mesh: null,
        sound: true,
        quality: 'std',
        subtitles: true,
      }
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return base
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return base
        const shots = Array.isArray(parsed.shots)
          ? parsed.shots.filter(shot => shot !== null && typeof shot === 'object' && Array.isArray(shot.scenes)).slice(0, MAX_SHOTS)
          : []
        const iterations = Array.isArray(parsed.iterations)
          ? parsed.iterations
            .filter(entry => entry !== null && typeof entry === 'object'
              && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.text === 'string')
            .slice(-MAX_ITERATIONS)
          : []
        return {
          prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
          mode: parsed.mode === '2d' || parsed.mode === '3d' ? parsed.mode : 'mixed',
          durationSec: DURATIONS.includes(parsed.durationSec) ? parsed.durationSec : 8,
          fps: parsed.fps === 24 ? 24 : 30,
          width: Number(parsed.width) === 1920 ? 1920 : Number(parsed.width) === 854 ? 854 : 1280,
          height: Number(parsed.height) === 1080 ? 1080 : Number(parsed.height) === 480 ? 480 : 720,
          style: typeof parsed.style === 'string' ? parsed.style : '',
          shots,
          iterations,
          activeShot: Number.isInteger(parsed.activeShot) ? Math.min(Math.max(0, parsed.activeShot), Math.max(0, shots.length - 1)) : 0,
          activeScene: Number.isInteger(parsed.activeScene) ? Math.max(0, parsed.activeScene) : 0,
          mesh: null,
          sound: parsed.sound !== false,
          quality: parsed.quality === 'fast' || parsed.quality === 'high' ? parsed.quality : 'std',
          subtitles: parsed.subtitles !== false,
        }
      } catch {
        return base
      }
    }

    /** Persist the studio state outside of React so panel switches keep the work. */
    let persistTimer = null
    function saveState(state) {
      if (persistTimer !== null) return
      persistTimer = window.setTimeout(() => {
        persistTimer = null
        try {
          // The parsed model is large and stays in memory only; everything else survives a reload.
          const compact = { ...state, mesh: null }
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compact))
        } catch {
          /* storage full or unavailable: the studio keeps working in memory */
        }
      }, 400)
    }

    /** Module store shared by the panel instance and its persistence. */
    const store = {
      state: loadState(),
      listeners: new Set(),
      set(patch) {
        store.state = { ...store.state, ...patch }
        saveState(store.state)
        for (const listener of store.listeners) listener()
      },
      subscribe(listener) {
        store.listeners.add(listener)
        return () => {
          store.listeners.delete(listener)
        }
      },
    }

    /** Subscribe the calling component to the module store. */
    function useStudioState() {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force(value => value + 1)), [])
      return store.state
    }

    /**
     * Translate one key through the slot locale seat, falling back to the
     * dictionary of the current document language.
     * @param {any} seat - the slot `t` function when the renderer supplied it.
     * @param {string} key - dictionary key.
     * @param {Record<string, unknown>} [params] - named placeholders.
     * @returns {string} localized copy.
     */
    function translate(seat, key, params) {
      if (typeof seat === 'function') return seat(key, params)
      const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase()
      const dict = lang.startsWith('ru') ? DICTS.ru : DICTS.en
      let text = dict[key] ?? DICTS.en[key] ?? key
      if (params !== undefined) {
        for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value))
      }
      return text
    }

    /** Human-readable duration. */
    function formatSeconds(value) {
      const seconds = Math.round(Number(value) || 0)
      return `${seconds} s`
    }

    /** Filesystem-friendly file stem. */
    function slug(text) {
      const cleaned = String(text || 'neural-video').toLowerCase().replace(/[^a-z0-9\u0430-\u044f\u0451]+/gi, '-').replace(/^-+|-+$/g, '')
      return cleaned.slice(0, 48) || 'neural-video'
    }

    /** File extension for the produced container. */
    function extensionOf(mimeType) {
      return String(mimeType || '').includes('mp4') ? 'mp4' : 'webm'
    }

    /** Sum of the scene durations of one project. */
    function projectDuration(project) {
      return project.scenes.reduce((sum, scene) => sum + (Number(scene.durationSec) || 0), 0)
    }

    /** Flatten the timeline into renderer jobs for the iframe. */
    function timelineScenes(shots) {
      const scenes = []
      for (const shot of shots) {
        for (const scene of shot.scenes) {
          scenes.push({
            name: scene.name,
            engine: scene.engine === '3d' ? '3d' : scene.engine === 'mesh' ? 'mesh' : '2d',
            durationSec: Number(scene.durationSec) || 3,
            code: scene.code,
          })
        }
      }
      return scenes
    }

    /** A short continuation summary sent with an appended shot. */
    function continuationOf(shots) {
      return shots
        .map((shot, index) => `${index + 1}. ${shot.title} (${shot.engine}): ${shot.summary}`)
        .join('\n')
        .slice(0, 600)
    }

    /** The built-in demo project. */
    function exampleProject(t) {
      return {
        id: 'demo-orbital-rings',
        title: t('example.title'),
        summary: t('example.summary'),
        style: 'cinematic, deep space, glowing rings',
        engine: 'mixed',
        width: store.state.width,
        height: store.state.height,
        fps: store.state.fps,
        provider: 'built-in',
        model: 'demo',
        createdAt: new Date().toISOString(),
        scenes: [
          { name: t('example.scene1'), engine: '2d', durationSec: 5, brief: 'Starfield with orbital rings', code: EXAMPLE_2D },
          { name: t('example.scene2'), engine: '3d', durationSec: 5, brief: 'WebGL shader core', code: EXAMPLE_3D },
        ],
      }
    }

    /** Decorative sidebar glyph: a film frame with a spark. */
    function StudioIcon(props) {
      const size = Number(props.size) || 20
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block' },
      },
      h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2.5 }),
      h('path', { d: 'M7.5 5v14M16.5 5v14M3 9.2h4.5M3 14.8h4.5M16.5 9.2H21M16.5 14.8H21' }),
      h('path', { d: 'M12 8.2l1.05 2.15L15.3 11l-2.25.65L12 13.8l-1.05-2.15L8.7 11l2.25-.65z', fill: 'currentColor', stroke: 'none' }))
    }

    /**
     * The studio page registered under the `main` slot key.
     * @param {any} props - slot runtime props, including the locale `t` seat.
     * @returns {any} the page element.
     */
    function StudioPanel(props) {
      const t = key => translate(props.t, key)
      const tRef = React.useRef(props.t)
      tRef.current = props.t
      const state = useStudioState()
      const [busy, setBusy] = React.useState('idle')
      const [status, setStatus] = React.useState({ key: 'status.ready' })
      const [progress, setProgress] = React.useState(0)
      const [elapsed, setElapsed] = React.useState(0)
      const [error, setError] = React.useState(null)
      const [warning, setWarning] = React.useState(null)
      const [video, setVideo] = React.useState(null)
      const [audioTrack, setAudioTrack] = React.useState(null)
      const [info, setInfo] = React.useState({ ok: false, error: '' })
      const [frameKey, setFrameKey] = React.useState(0)
      const [refinement, setRefinement] = React.useState('')
      const [meshBusy, setMeshBusy] = React.useState(false)
      const meshInputRef = React.useRef(null)
      const iframeRef = React.useRef(null)
      const pendingRef = React.useRef(null)
      const sentRef = React.useRef(false)
      const abortRef = React.useRef(null)
      const videoUrlRef = React.useRef(null)
      const audioUrlRef = React.useRef(null)

      const tt = React.useCallback((key, params) => translate(tRef.current, key, params), [])
      const say = React.useCallback((key, params) => setStatus(params === undefined ? { key } : { key, params }), [])

      /** Replace the recorded clip, revoking the previous object URL. */
      const adoptVideo = React.useCallback((blob, mimeType, durationSec, name) => {
        if (videoUrlRef.current !== null) {
          try { URL.revokeObjectURL(videoUrlRef.current) } catch { /* already gone */ }
        }
        const url = URL.createObjectURL(blob)
        videoUrlRef.current = url
        setVideo({ url, mimeType, durationSec, name })
      }, [])

      /** Drop the recorded clip: the timeline or the code changed. */
      const releaseVideo = React.useCallback(() => {
        if (videoUrlRef.current !== null) {
          try { URL.revokeObjectURL(videoUrlRef.current) } catch { /* already gone */ }
          videoUrlRef.current = null
        }
        setVideo(null)
      }, [])

      React.useEffect(() => () => {
        if (videoUrlRef.current !== null) URL.revokeObjectURL(videoUrlRef.current)
        if (audioUrlRef.current !== null) URL.revokeObjectURL(audioUrlRef.current)
      }, [])

      /** Keep the rendered soundtrack as a downloadable WAV, replacing the old one. */
      const adoptAudio = React.useCallback((blob) => {
        if (audioUrlRef.current !== null) {
          try { URL.revokeObjectURL(audioUrlRef.current) } catch { /* already gone */ }
        }
        const url = URL.createObjectURL(blob)
        audioUrlRef.current = url
        setAudioTrack({ url })
      }, [])

      /** Drop the soundtrack of a previous render. */
      const releaseAudio = React.useCallback(() => {
        if (audioUrlRef.current !== null) {
          try { URL.revokeObjectURL(audioUrlRef.current) } catch { /* already gone */ }
          audioUrlRef.current = null
        }
        setAudioTrack(null)
      }, [])

      React.useEffect(() => {
        let alive = true
        fetch(INFO_PATH, { headers: { accept: 'application/json' } })
          .then(response => response.json())
          .then((data) => { if (alive) setInfo(data ?? { ok: false, error: '' }) })
          .catch((cause) => { if (alive) setInfo({ ok: false, error: String(cause && cause.message ? cause.message : cause) }) })
        return () => { alive = false }
      }, [])

      React.useEffect(() => {
        if (busy !== 'generating' && busy !== 'rendering') {
          setElapsed(0)
          return undefined
        }
        const startedAt = Date.now()
        const timer = window.setInterval(() => { setElapsed((Date.now() - startedAt) / 1000) }, 250)
        return () => { window.clearInterval(timer) }
      }, [busy])

      const sendPending = React.useCallback(() => {
        const frame = iframeRef.current
        if (frame === null || pendingRef.current === null || sentRef.current) return
        sentRef.current = true
        try {
          frame.contentWindow.postMessage(pendingRef.current, '*')
        } catch {
          /* the frame went away mid-post */
        }
      }, [])

      React.useEffect(() => {
        const onMessage = (event) => {
          const frame = iframeRef.current
          if (frame === null || event.source !== frame.contentWindow) return
          const data = event.data
          if (data === null || typeof data !== 'object') return
          if (data.type === 'ready') {
            sendPending()
            return
          }
          if (data.type === 'started') {
            say(data.sound === true ? 'status.renderingSound' : 'status.rendering')
            return
          }
          if (data.type === 'audioBuilding') {
            say('status.audioBuilding')
            return
          }
          if (data.type === 'audioGate') {
            say('status.audioGate')
            return
          }
          if (data.type === 'audioTrack' && data.blob instanceof Blob) {
            adoptAudio(data.blob)
            return
          }
          if (data.type === 'warning') {
            setWarning(String(data.message ?? ''))
            return
          }
          if (data.type === 'scene') {
            setStatus({ key: 'status.scene', params: { index: Number(data.index) + 1, name: data.name } })
            return
          }
          if (data.type === 'progress') {
            const total = Number(data.total) || 0
            setProgress(total > 0 ? Math.min(1, Number(data.elapsed) / total) : 0)
            return
          }
          if (data.type === 'done') {
            const name = `${slug(store.state.shots[0]?.title ?? 'neural-video')}.${extensionOf(data.mimeType)}`
            adoptVideo(data.blob, data.mimeType, data.durationSec, name)
            setProgress(1)
            setBusy('idle')
            say('status.done')
            return
          }
          if (data.type === 'error') {
            setBusy('error')
            setError(String(data.message ?? tt('error.empty')))
          }
        }
        window.addEventListener('message', onMessage)
        return () => { window.removeEventListener('message', onMessage) }
      }, [adoptAudio, adoptVideo, sendPending, tt, say])

      /** Start one generation request; `append` adds a shot to the timeline. */
      const generate = async (append) => {
        const current = store.state
        if (current.prompt.trim().length < 3) {
          setError(t('error.prompt'))
          setBusy('error')
          return
        }
        const controller = new AbortController()
        abortRef.current = controller
        releaseVideo()
        releaseAudio()
        setWarning(null)
        setError(null)
        setBusy('generating')
        setProgress(0)
        say('status.planning')
        try {
          const response = await fetch(GENERATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              prompt: current.prompt,
              mode: current.mode,
              durationSec: current.durationSec,
              fps: current.fps,
              width: current.width,
              height: current.height,
              style: current.style,
              continuation: append ? continuationOf(current.shots) : '',
              sound: current.sound !== false,
              ...(current.mesh === null
                ? {}
                : { mesh: { name: current.mesh.name, triangles: current.mesh.triangles } }),
            }),
            signal: controller.signal,
          })
          let data = null
          try {
            data = await response.json()
          } catch {
            data = null
          }
          if (!response.ok || data === null || data.ok !== true) {
            const reason = data !== null && (data.error || data.code) ? (data.error || data.code) : `HTTP ${response.status}`
            throw new Error(reason)
          }
          const project = data.project
          if (project === null || typeof project !== 'object' || !Array.isArray(project.scenes) || project.scenes.length === 0) {
            throw new Error('The model returned no scenes. Try again.')
          }
          if (append) {
            const shots = [...store.state.shots, project].slice(0, MAX_SHOTS)
            store.set({ shots, activeShot: Math.min(shots.length - 1, store.state.shots.length), activeScene: 0 })
          } else {
            store.set({ shots: [project], activeShot: 0, activeScene: 0 })
          }
          if (typeof project.audioError === 'string' && project.audioError !== '') setWarning(project.audioError)
          setBusy('idle')
          say('status.generated')
        } catch (cause) {
          if (cause !== null && typeof cause === 'object' && cause.name === 'AbortError') {
            setBusy('idle')
            say('status.cancelled')
          } else {
            setBusy('error')
            setError(String(cause && cause.message ? cause.message : cause))
          }
        } finally {
          abortRef.current = null
        }
      }

      /** Record the whole timeline in the sandboxed renderer. */
      const startRender = () => {
        const current = store.state
        const scenes = timelineScenes(current.shots)
        if (scenes.length === 0) {
          setError(t('error.empty'))
          setBusy('error')
          return
        }
        if (scenes.some(scene => typeof scene.code !== 'string' || scene.code.trim() === '')) {
          setError(t('error.code'))
          setBusy('error')
          return
        }
        const needsMesh = scenes.some(scene => scene.engine === 'mesh')
        if (needsMesh && current.mesh === null) {
          setError(t('error.meshScene'))
          setBusy('error')
          return
        }
        if (typeof MediaRecorder === 'undefined') {
          setError(t('error.recorder'))
          setBusy('error')
          return
        }
        releaseVideo()
        releaseAudio()
        setWarning(null)
        setError(null)
        setProgress(0)
        setBusy('rendering')
        say('status.rendering')
        const audioTracks = []
        if (current.sound !== false) {
          for (const shot of current.shots) {
            if (shot.audio !== null && typeof shot.audio === 'object'
              && typeof shot.audio.code === 'string' && shot.audio.code.trim() !== '') {
              audioTracks.push({ code: shot.audio.code, durationSec: projectDuration(shot) })
            }
          }
        }
        const dialog = []
        let dialogOffset = 0
        for (const shot of current.shots) {
          if (Array.isArray(shot.dialog)) {
            for (const line of shot.dialog) {
              dialog.push({
                at: Math.round((dialogOffset + (Number(line.at) || 0)) * 10) / 10,
                duration: Number(line.duration) || 2,
                text: String(line.text ?? ''),
                voice: line.voice ?? 'narrator',
              })
            }
          }
          dialogOffset += projectDuration(shot)
        }
        pendingRef.current = {
          type: 'render',
          width: current.width,
          height: current.height,
          fps: current.fps,
          scenes,
          sound: current.sound !== false,
          audioTracks,
          dialog,
          subtitles: current.subtitles !== false,
          quality: current.quality ?? 'std',
          ...(needsMesh && current.mesh !== null
            ? {
              mesh: {
                positions: current.mesh.positions,
                normals: current.mesh.normals,
                ao: current.mesh.ao,
                minY: current.mesh.minY,
                maxY: current.mesh.maxY,
                partIndex: current.mesh.partIndex
                  ?? new Float32Array(current.mesh.positions.length / 3),
                parts: Array.isArray(current.mesh.parts)
                  ? current.mesh.parts.map(part => part.center)
                  : [],
              },
            }
            : {}),
        }
        sentRef.current = false
        setFrameKey(value => value + 1)
      }

      /** Stop whatever is running: generation request or frame recording. */
      const cancelRun = () => {
        if (abortRef.current !== null) {
          abortRef.current.abort()
          abortRef.current = null
        }
        pendingRef.current = null
        sentRef.current = false
        setProgress(0)
        setBusy('idle')
        say('status.cancelled')
      }

      /** Update one scene's code and drop the now-stale recording. */
      const updateCode = (code) => {
        const current = store.state
        const shot = current.shots[current.activeShot]
        if (shot === undefined) return
        const scenes = shot.scenes.map((scene, index) => index === current.activeScene ? { ...scene, code } : scene)
        const shots = current.shots.map((row, index) => index === current.activeShot ? { ...row, scenes } : row)
        releaseVideo()
        releaseAudio()
        store.set({ shots })
      }

      const removeShot = (index) => {
        const shots = store.state.shots.filter((_, at) => at !== index)
        releaseVideo()
        releaseAudio()
        store.set({
          shots,
          activeShot: Math.min(Math.max(0, index - 1), Math.max(0, shots.length - 1)),
          activeScene: 0,
        })
      }

      const moveShot = (index, delta) => {
        const target = index + delta
        const shots = store.state.shots
        if (target < 0 || target >= shots.length) return
        const next = [...shots]
        const [moved] = next.splice(index, 1)
        next.splice(target, 0, moved)
        releaseVideo()
        releaseAudio()
        store.set({ shots: next, activeShot: target })
      }

      const loadExample = () => {
        releaseVideo()
        releaseAudio()
        setWarning(null)
        store.set({ shots: [exampleProject(t)], activeShot: 0, activeScene: 0 })
        setError(null)
        setBusy('idle')
        say('status.generated')
      }

      const downloadProject = () => {
        const payload = JSON.stringify({ kind: 'neural-video-studio/project', version: 1, settings: { width: store.state.width, height: store.state.height, fps: store.state.fps }, shots: store.state.shots }, null, 2)
        const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${slug(store.state.shots[0]?.title ?? 'neural-video')}-project.json`
        anchor.style.display = 'none'
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 4000)
      }

      /** Read one uploaded 3D file into a normalized mesh the renderer can draw. */
      const onMeshFile = async (event) => {
        const input = event.target
        const file = input.files && input.files[0]
        input.value = ''
        if (!file) return
        if (file.size > MAX_MESH_BYTES) {
          setError(t('error.meshSize'))
          setBusy('error')
          return
        }
        setMeshBusy(true)
        setError(null)
        try {
          const buffer = await file.arrayBuffer()
          const mesh = await parseModelFile(file.name, buffer)
          store.set({ mesh })
          say('status.meshLoaded')
        } catch (cause) {
          setError(String(cause && cause.message ? cause.message : cause))
          setBusy('error')
        } finally {
          setMeshBusy(false)
        }
      }

      const removeMesh = () => {
        store.set({ mesh: null })
      }

      /** Ask the model to revise the active film from one instruction. */
      const refineFilm = async () => {
        const current = store.state
        const shot = current.shots[current.activeShot]
        if (shot === undefined) {
          setError(t('error.empty'))
          setBusy('error')
          return
        }
        const instruction = refinement.trim()
        if (instruction.length < 2) {
          setError(t('error.instruction'))
          return
        }
        if (busy !== 'idle') return
        const controller = new AbortController()
        abortRef.current = controller
        releaseVideo()
        releaseAudio()
        setWarning(null)
        setError(null)
        setBusy('generating')
        setProgress(0)
        say('status.refining')
        try {
          const response = await fetch(REFINE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              project: shot,
              instruction,
              sound: current.sound !== false,
              ...(current.mesh === null
                ? {}
                : { mesh: { name: current.mesh.name, triangles: current.mesh.triangles } }),
            }),
            signal: controller.signal,
          })
          let data = null
          try {
            data = await response.json()
          } catch {
            data = null
          }
          if (!response.ok || data === null || data.ok !== true) {
            const reason = data !== null && (data.error || data.code) ? (data.error || data.code) : `HTTP ${response.status}`
            throw new Error(reason)
          }
          const project = data.project
          if (project === null || typeof project !== 'object' || !Array.isArray(project.scenes) || project.scenes.length === 0) {
            throw new Error('The model returned no scenes. Try again.')
          }
          const reply = typeof data.reply === 'string' && data.reply !== '' ? data.reply : t('iter.applied')
          const shots = store.state.shots.map((row, index) => index === store.state.activeShot ? project : row)
          const iterations = [
            ...store.state.iterations,
            { role: 'user', text: instruction, at: Date.now() },
            { role: 'assistant', text: reply, at: Date.now() },
          ].slice(-MAX_ITERATIONS)
          store.set({ shots, iterations, activeScene: 0 })
          if (typeof project.audioError === 'string' && project.audioError !== '') setWarning(project.audioError)
          setRefinement('')
          setBusy('idle')
          say('status.refined')
        } catch (cause) {
          if (cause !== null && typeof cause === 'object' && cause.name === 'AbortError') {
            setBusy('idle')
            say('status.cancelled')
          } else {
            setBusy('error')
            setError(String(cause && cause.message ? cause.message : cause))
          }
        } finally {
          abortRef.current = null
        }
      }

      const activeShot = state.shots[state.activeShot]
      const activeScene = activeShot !== undefined ? activeShot.scenes[state.activeScene] : undefined
      const totalSeconds = state.shots.reduce((sum, shot) => sum + projectDuration(shot), 0)
      const statusText = status.key === 'status.scene'
        ? tt(status.key, status.params)
        : tt(status.key)
      const running = busy === 'generating' || busy === 'rendering'
      const rendered = video !== null
      const modelText = info.ok === true
        ? `${info.provider} · ${info.model}`
        : `${t('model.missing')}${info.error ? `: ${info.error}` : ''}`

      function renderForm() {
        const resolutionValue = `${state.width}x${state.height}`
        return h('div', { className: 'nvs-card' },
          h('div', { className: 'nvs-card-head' },
            h('h2', { className: 'nvs-card-title' }, t('form.prompt')),
            h('span', { className: 'nvs-hint' }, t('hint.generating'))),
          h('label', { className: 'nvs-field' },
            h('textarea', {
              className: 'nvs-textarea',
              rows: 4,
              value: state.prompt,
              placeholder: t('form.placeholder'),
              'aria-label': t('form.prompt'),
              onChange: event => store.set({ prompt: event.target.value }),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !running) {
                  event.preventDefault()
                  void generate(false)
                }
              },
            })),
          h('div', { className: 'nvs-field' },
            h('span', { className: 'nvs-label' }, t('form.mode')),
            h('div', { className: 'nvs-seg', role: 'group', 'aria-label': t('form.mode') },
              [['2d', 'mode.2d'], ['3d', 'mode.3d'], ['mixed', 'mode.mixed']].map(([value, key]) =>
                h('button', {
                  key: value,
                  type: 'button',
                  'aria-pressed': state.mode === value,
                  onClick: () => store.set({ mode: value }),
                }, t(key))))),
          h('div', { className: 'nvs-field' },
            h('span', { className: 'nvs-label' }, t('form.sound')),
            h('div', { className: 'nvs-seg', role: 'group', 'aria-label': t('form.sound') },
              [['sound-on', 'sound.on'], ['sound-off', 'sound.off']].map(([value, key]) => h('button', {
                key: value,
                type: 'button',
                'aria-pressed': value === 'sound-on' ? state.sound !== false : state.sound === false,
                onClick: () => store.set({ sound: value === 'sound-on' }),
              }, t(key))))),
          h('div', { className: 'nvs-fields' },
            h('label', { className: 'nvs-field' },
              h('span', { className: 'nvs-label' }, t('form.quality')),
              h('select', {
                className: 'nvs-select',
                value: state.quality ?? 'std',
                onChange: event => store.set({ quality: event.target.value }),
              }, [['fast', 'quality.fast'], ['std', 'quality.std'], ['high', 'quality.high']].map(([value, key]) => h('option', { key: value, value }, t(key))))),
            h('label', { className: 'nvs-field' },
              h('span', { className: 'nvs-label' }, t('form.subtitles')),
              h('div', { className: 'nvs-seg', role: 'group', 'aria-label': t('form.subtitles') },
                [['subs-on', 'subtitles.on'], ['subs-off', 'subtitles.off']].map(([value, key]) => h('button', {
                  key: value,
                  type: 'button',
                  'aria-pressed': value === 'subs-on' ? state.subtitles !== false : state.subtitles === false,
                  onClick: () => store.set({ subtitles: value === 'subs-on' }),
                }, t(key))))),
            h('span', { className: 'nvs-hint', style: { alignSelf: 'end' } }, t('preview.note'))),
          h('div', { className: 'nvs-fields' },
            h('label', { className: 'nvs-field' },
              h('span', { className: 'nvs-label' }, t('form.duration')),
              h('select', {
                className: 'nvs-select',
                value: state.durationSec,
                onChange: event => store.set({ durationSec: Number(event.target.value) }),
              }, DURATIONS.map(value => h('option', { key: value, value }, formatSeconds(value))))),
            h('label', { className: 'nvs-field' },
              h('span', { className: 'nvs-label' }, t('form.fps')),
              h('select', {
                className: 'nvs-select',
                value: state.fps,
                onChange: event => store.set({ fps: Number(event.target.value) }),
              }, [24, 30].map(value => h('option', { key: value, value }, String(value))))),
            h('label', { className: 'nvs-field' },
              h('span', { className: 'nvs-label' }, t('form.resolution')),
              h('select', {
                className: 'nvs-select',
                value: resolutionValue,
                onChange: (event) => {
                  const next = RESOLUTIONS.find(row => `${row.width}x${row.height}` === event.target.value)
                  if (next !== undefined) store.set({ width: next.width, height: next.height })
                },
              }, RESOLUTIONS.map(row => h('option', { key: row.label, value: `${row.width}x${row.height}` }, row.label))))),
          h('label', { className: 'nvs-field' },
            h('span', { className: 'nvs-label' }, t('form.style')),
            h('input', {
              className: 'nvs-input',
              type: 'text',
              value: state.style,
              placeholder: t('form.stylePlaceholder'),
              onChange: event => store.set({ style: event.target.value }),
            })),
          h('div', { className: 'nvs-chips' },
            STYLE_PRESETS.map(preset => h('button', {
              key: preset.key,
              type: 'button',
              className: 'nvs-chip',
              'aria-pressed': state.style === preset.prompt,
              onClick: () => store.set({ style: state.style === preset.prompt ? '' : preset.prompt }),
            }, t(preset.key)))),
          h('div', { className: 'nvs-actions' },
            h('button', {
              type: 'button',
              className: 'nvs-btn nvs-btn-primary',
              disabled: running,
              onClick: () => { void generate(false) },
            }, t('action.generate')),
            h('button', {
              type: 'button',
              className: 'nvs-btn',
              disabled: running || state.shots.length === 0,
              onClick: () => { void generate(true) },
            }, t('action.append')),
            running ? h('button', { type: 'button', className: 'nvs-btn', onClick: cancelRun }, t('action.cancel')) : null,
            h('button', {
              type: 'button',
              className: 'nvs-btn',
              disabled: running,
              onClick: loadExample,
            }, t('action.example'))))
      }

      function renderTimeline() {
        return h('div', { className: 'nvs-card' },
          h('div', { className: 'nvs-card-head' },
            h('h2', { className: 'nvs-card-title' }, t('timeline.title')),
            h('span', { className: 'nvs-hint' }, `${state.shots.length} · ${formatSeconds(totalSeconds)}`)),
          state.shots.length === 0
            ? h('div', { className: 'nvs-empty' }, t('timeline.empty'))
            : h('div', {}, state.shots.map((shot, index) => h('div', {
              key: shot.id ?? index,
              className: 'nvs-shot',
              'data-active': index === state.activeShot,
            },
            h('button', {
              type: 'button',
              className: 'nvs-shot-main',
              onClick: () => store.set({ activeShot: index, activeScene: 0 }),
            },
            h('span', { className: 'nvs-shot-title' }, shot.title ?? ''),
            h('span', { className: 'nvs-shot-meta' },
              `${shot.scenes.length} · ${formatSeconds(projectDuration(shot))} · ${String(shot.engine ?? '').toUpperCase()} · ${shot.provider ?? '?'}/${shot.model ?? '?'}`)),
            h('div', { className: 'nvs-shot-tools' },
              h('button', {
                type: 'button',
                className: 'nvs-btn nvs-btn-icon',
                'aria-label': t('action.moveUp'),
                disabled: index === 0,
                onClick: () => moveShot(index, -1),
              }, '↑'),
              h('button', {
                type: 'button',
                className: 'nvs-btn nvs-btn-icon',
                'aria-label': t('action.moveDown'),
                disabled: index === state.shots.length - 1,
                onClick: () => moveShot(index, 1),
              }, '↓'),
              h('button', {
                type: 'button',
                className: 'nvs-btn nvs-btn-icon',
                'aria-label': t('action.remove'),
                onClick: () => removeShot(index),
              }, '✕'))))),
          activeShot !== undefined && activeScene !== undefined
            ? h('div', {},
              h('div', { className: 'nvs-scenes' }, activeShot.scenes.map((scene, index) => h('button', {
                key: index,
                type: 'button',
                className: 'nvs-scene-tab',
                'aria-pressed': index === state.activeScene,
                onClick: () => store.set({ activeScene: index }),
              }, `${index + 1}. ${scene.name} · ${String(scene.engine).toUpperCase()} · ${formatSeconds(scene.durationSec)}`))),
              h('div', { className: 'nvs-card-head' },
                h('h2', { className: 'nvs-card-title' }, t('code.title')),
                h('span', { className: 'nvs-hint' }, String(t('code.chars')).replace('{count}', String((activeScene.code ?? '').length)))),
              h('p', { className: 'nvs-hint', style: { margin: '0 0 8px' } }, activeScene.engine === 'mesh' ? t('code.hintMesh') : t('code.hint')),
              h('textarea', {
                className: 'nvs-code',
                spellCheck: false,
                wrap: 'off',
                value: activeScene.code ?? '',
                'aria-label': t('code.title'),
                onChange: event => updateCode(event.target.value),
              }))
            : null)
      }

      function renderMeshCard() {
        const mesh = state.mesh
        return h('div', { className: 'nvs-card' },
          h('div', { className: 'nvs-card-head' },
            h('h2', { className: 'nvs-card-title' }, t('mesh.title')),
            h('span', { className: 'nvs-hint' }, t('mesh.hint'))),
          h('input', {
            ref: meshInputRef,
            type: 'file',
            accept: '.glb,.obj,.stl,model/gltf-binary,model/obj,model/stl',
            style: { display: 'none' },
            'aria-label': t('mesh.load'),
            onChange: event => { void onMeshFile(event) },
          }),
          mesh === null || mesh === undefined
            ? h('div', { className: 'nvs-actions' },
              h('button', {
                type: 'button',
                className: 'nvs-btn',
                disabled: meshBusy,
                onClick: () => { meshInputRef.current?.click() },
              }, meshBusy ? t('mesh.loading') : t('mesh.load')),
              h('span', { className: 'nvs-hint' }, t('mesh.formats')))
            : h('div', {},
              h('div', { className: 'nvs-mesh-info' },
                h('span', { className: 'nvs-mesh-glyph', 'aria-hidden': true }, '◆'),
                h('span', { className: 'nvs-mesh-name' }, mesh.name),
                h('span', { className: 'nvs-hint' }, `${mesh.triangles.toLocaleString()} ${t('mesh.triangles')}`),
                h('span', { className: 'nvs-hint' },
                  `${t(`mesh.kind.${mesh.analysis?.kind ?? 'object'}`)} · ${Array.isArray(mesh.parts) ? mesh.parts.length : 0} ${t('mesh.partsCount')}`),
                h('button', {
                  type: 'button',
                  className: 'nvs-btn nvs-btn-icon',
                  'aria-label': t('mesh.remove'),
                  onClick: removeMesh,
                }, '✕')),
              h('p', { className: 'nvs-hint', style: { margin: '8px 0 0' } }, t('mesh.readyHint'))))
      }

      function renderIterations() {
        return h('div', { className: 'nvs-card' },
          h('div', { className: 'nvs-card-head' },
            h('h2', { className: 'nvs-card-title' }, t('iter.title')),
            h('span', { className: 'nvs-hint' }, t('iter.hint'))),
          state.iterations.length === 0
            ? h('div', { className: 'nvs-empty' }, t('iter.empty'))
            : h('div', { className: 'nvs-log', role: 'log', 'aria-label': t('iter.title') },
              state.iterations.map((entry, index) => h('div', {
                key: `${entry.at ?? index}-${index}`,
                className: 'nvs-log-row',
                'data-role': entry.role,
              },
              h('span', { className: 'nvs-log-role' }, entry.role === 'user' ? t('iter.you') : t('iter.model')),
              h('span', { className: 'nvs-log-text' }, entry.text)))),
          h('div', { className: 'nvs-refine' },
            h('textarea', {
              className: 'nvs-textarea nvs-refine-input',
              rows: 2,
              value: refinement,
              placeholder: t('iter.placeholder'),
              'aria-label': t('iter.placeholder'),
              onChange: event => setRefinement(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void refineFilm()
                }
              },
            }),
            h('button', {
              type: 'button',
              className: 'nvs-btn nvs-btn-primary',
              disabled: running || activeShot === undefined || refinement.trim().length < 2,
              onClick: () => { void refineFilm() },
            }, t('action.applyRefine'))))
      }

      function renderPreview() {
        const stage = busy === 'rendering'
          ? h('iframe', {
            key: frameKey,
            ref: iframeRef,
            className: 'nvs-frame',
            title: t('preview.title'),
            sandbox: 'allow-scripts',
            srcDoc: RENDER_DOC,
            onLoad: sendPending,
          })
          : rendered
            ? h('video', {
              className: 'nvs-video',
              src: video.url,
              controls: true,
              loop: true,
              playsInline: true,
            })
            : h('div', { className: 'nvs-stage-empty' }, t('preview.empty'))

        return h('div', { className: 'nvs-card' },
          h('div', { className: 'nvs-card-head' },
            h('h2', { className: 'nvs-card-title' }, t('preview.title')),
            h('span', { className: 'nvs-hint' }, `${t('timeline.total')}: ${formatSeconds(totalSeconds)}`)),
          h('div', { className: 'nvs-stage' }, stage),
          running
            ? h('div', {},
              h('div', { className: 'nvs-progress', 'data-indeterminate': busy === 'generating' },
                h('span', { style: { width: `${Math.round(progress * 100)}%` } })),
              h('div', { className: 'nvs-status', role: 'status' },
                statusText,
                elapsed > 0 ? ` · ${Math.floor(elapsed)} s` : '',
                busy === 'rendering' && progress > 0 ? ` · ${Math.round(progress * 100)}%` : ''),
              h('div', { className: 'nvs-actions' },
                h('button', { type: 'button', className: 'nvs-btn', onClick: cancelRun }, t('action.cancel')),
                h('span', { className: 'nvs-hint' }, busy === 'rendering' ? t('hint.rendering') : t('hint.generating'))))
            : h('div', { className: 'nvs-actions', style: { marginTop: '12px' } },
              h('button', {
                type: 'button',
                className: 'nvs-btn nvs-btn-primary',
                disabled: state.shots.length === 0,
                onClick: startRender,
              }, t('action.render')),
              rendered
                ? h('a', {
                  className: 'nvs-btn',
                  href: video.url,
                  download: video.name,
                }, t('action.download'))
                : null,
              audioTrack !== null
                ? h('a', {
                  className: 'nvs-btn',
                  href: audioTrack.url,
                  download: `${slug(store.state.shots[0]?.title ?? 'neural-video')}-sound.wav`,
                }, t('action.downloadAudio'))
                : null,
              state.shots.length > 0
                ? h('button', { type: 'button', className: 'nvs-btn', onClick: downloadProject }, t('action.project'))
                : null),
          warning !== null
            ? h('div', { className: 'nvs-warning', role: 'status' }, warning)
            : null,
          error !== null
            ? h('div', { className: 'nvs-error', role: 'alert' }, error)
            : null,
          h('p', { className: 'nvs-footnote' }, t('preview.note')))
      }

      return h('section', { className: 'nvs-page', 'aria-label': t('header.title') },
        h('div', { className: 'nvs-scroll' },
          h('div', { className: 'nvs-content' },
            h('header', { className: 'nvs-head' },
              h('div', {},
                h('h1', { className: 'nvs-title' }, t('header.title')),
                h('p', { className: 'nvs-sub' }, t('header.subtitle'))),
              h('div', { className: 'nvs-model', 'data-ok': info.ok === true ? 'true' : 'false', title: modelText },
                `${t('preview.model')}: ${modelText}`)),
            h('div', { className: 'nvs-grid' },
              h('div', {}, renderForm(), renderMeshCard(), renderTimeline(), renderIterations()),
              h('div', {}, renderPreview())))))
    }

    /** Insert this plugin's stylesheet as one owned effect. */
    function installStyles() {
      const style = document.createElement('style')
      style.dataset.plugin = '@local/neural-video-studio'
      style.textContent = CSS
      document.head.append(style)
      return () => {
        style.remove()
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTS), 'neural-video-studio: dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.effect(installStyles, 'neural-video-studio: stylesheet')
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          locale: NS,
          label: () => t('panel'),
        }, StudioIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, StudioPanel))
      },
    }
  },
})
