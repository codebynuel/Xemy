import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ─── App State ─────────────────────────────────────────────────────────────────
let socket, sessionId;
let scene, camera, renderer, controls, gridHelper;
let currentModel = null;
let currentModelUrl = null;

// ─── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await verifyAuth();
    initSocketio();
    initViewport();
    bindForgeButton();
    bindOptionsButton();
    bindExportButton();
    bindViewportControls();
    bindTransformInputs();
    bindMaterialSliders();
});

// ─── Auth ──────────────────────────────────────────────────────────────────────
async function verifyAuth() {
    try {
        const res = await fetch('/api/auth/verify');
        const data = await res.json();
        if (!data.authenticated) {
            window.location.replace('/auth/index.html');
            return;
        }
        const name = data.user.name || data.user.email;
        const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        document.getElementById('user-name').textContent = name;
        document.getElementById('user-plan').textContent = 'Pro Plan';
        document.getElementById('user-initials').textContent = initials;
    } catch {
        window.location.replace('/auth/index.html');
    }
}

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
function initSocketio() {
    sessionId = sessionStorage.getItem('xemy_session') || crypto.randomUUID();
    sessionStorage.setItem('xemy_session', sessionId);

    socket = io();
    socket.on('connect', () => socket.emit('register_session', sessionId));

    socket.on('generation_status', ({ status }) => {
        const messages = {
            IN_QUEUE:    'In queue — waiting for GPU...',
            IN_PROGRESS: 'Generating model...',
        };
        setStatus('busy', messages[status] || `Status: ${status}`);
    });

    socket.on('generation_complete', ({ modelUrl }) => {
        currentModelUrl = modelUrl;
        setStatus('loading', 'Downloading model...');
        loadModel(modelUrl);
    });

    socket.on('generation_failed', ({ error }) => {
        setStatus('error', `Failed: ${error}`);
        setForgeState('idle');
    });
}

// ─── Three.js Viewport ─────────────────────────────────────────────────────────
function initViewport() {
    const container = document.getElementById('viewport-container');
    const canvas = document.getElementById('viewport-canvas');

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        45,
        container.clientWidth / container.clientHeight,
        0.01,
        1000
    );
    camera.position.set(0, 2, 5);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    addDirLight(0xcf96ff, 2.0, [5, 8, 5]);
    addDirLight(0x00eefc, 0.8, [-5, 2, -5]);
    addDirLight(0xff59e3, 0.3, [0, -4, 2]);

    gridHelper = new THREE.GridHelper(14, 28, 0x48474a, 0x262528);
    gridHelper.material.opacity = 0.4;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.5;
    controls.maxDistance = 50;

    const ro = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });
    ro.observe(container);

    (function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    })();
}

function addDirLight(color, intensity, position) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(...position);
    scene.add(light);
}

function loadModel(url) {
    showViewportLoader(true);
    const loader = new OBJLoader();
    loader.load(
        url,
        (obj) => {
            if (currentModel) scene.remove(currentModel);

            const box = new THREE.Box3().setFromObject(obj);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            obj.position.sub(center);
            if (maxDim > 0) obj.scale.multiplyScalar(2.5 / maxDim);

            const mat = new THREE.MeshStandardMaterial({
                color: 0xcf96ff,
                metalness: 0.85,
                roughness: 0.12,
            });
            obj.traverse(child => {
                if (child.isMesh) child.material = mat;
            });

            scene.add(obj);
            currentModel = obj;

            syncTransformInputs();
            addToSceneGraph();
            addToHistory('Model forged');
            setStatus('ready', 'Ready to generate');
            setForgeState('idle');
            showViewportLoader(false);
        },
        undefined,
        (err) => {
            console.error(err);
            setStatus('error', 'Failed to load model');
            setForgeState('idle');
            showViewportLoader(false);
        }
    );
}

function showViewportLoader(show) {
    document.getElementById('viewport-loader')?.classList.toggle('hidden', !show);
}

// ─── Forge ─────────────────────────────────────────────────────────────────────
function bindForgeButton() {
    document.getElementById('forge-btn').addEventListener('click', forge);
    document.getElementById('prompt-input').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) forge();
    });
}

async function forge() {
    const prompt = document.getElementById('prompt-input').value.trim();
    if (!prompt) {
        document.getElementById('prompt-input').focus();
        return;
    }

    const guidanceScale = parseFloat(document.getElementById('opt-guidance')?.value ?? '15');
    const quality = document.getElementById('opt-quality')?.value ?? 'balanced';
    const stepsMap = { fast: 32, balanced: 64, quality: 128 };
    const steps = stepsMap[quality] ?? 64;

    setForgeState('loading');
    setStatus('busy', 'Submitting to forge...');
    document.getElementById('options-panel')?.classList.add('hidden');

    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, sessionId, guidanceScale, steps }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Request failed');
        }
        const data = await res.json();
        setStatus('busy', `Forging — Job ${(data.jobId || '').slice(0, 8) || '...'}`);
    } catch (err) {
        setStatus('error', err.message);
        setForgeState('idle');
    }
}

// ─── Options Panel ─────────────────────────────────────────────────────────────
function bindOptionsButton() {
    const btn = document.getElementById('options-btn');
    const panel = document.getElementById('options-panel');
    if (!btn || !panel) return;

    btn.addEventListener('click', e => {
        e.stopPropagation();
        panel.classList.toggle('hidden');
    });

    document.addEventListener('click', e => {
        if (!panel.classList.contains('hidden') && !panel.contains(e.target) && e.target !== btn) {
            panel.classList.add('hidden');
        }
    });
}

// ─── Export ────────────────────────────────────────────────────────────────────
function bindExportButton() {
    document.getElementById('export-btn').addEventListener('click', () => {
        if (!currentModelUrl) {
            setStatus('error', 'No model to export');
            return;
        }
        const a = document.createElement('a');
        a.href = currentModelUrl;
        a.download = 'xemy_model.obj';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
}

// ─── Viewport Controls ─────────────────────────────────────────────────────────
function bindViewportControls() {
    document.getElementById('ctrl-camera').addEventListener('click', () => {
        camera.position.set(0, 2, 5);
        controls.target.set(0, 0, 0);
        controls.update();
    });

    document.getElementById('ctrl-grid').addEventListener('click', () => {
        gridHelper.visible = !gridHelper.visible;
    });

    document.getElementById('ctrl-screenshot').addEventListener('click', () => {
        renderer.render(scene, camera);
        const url = renderer.domElement.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = 'xemy_viewport.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    document.getElementById('ctrl-fullscreen').addEventListener('click', () => {
        const el = document.getElementById('viewport-container');
        if (!document.fullscreenElement) {
            el.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
    });
}

// ─── Transform Panel ───────────────────────────────────────────────────────────
function bindTransformInputs() {
    ['x', 'y', 'z'].forEach(axis => {
        const input = document.getElementById(`transform-${axis}`);
        if (!input) return;
        input.addEventListener('change', () => {
            if (!currentModel) return;
            const val = parseFloat(input.value) || 0;
            currentModel.position[axis] = val;
        });
    });
}

function syncTransformInputs() {
    if (!currentModel) return;
    ['x', 'y', 'z'].forEach(axis => {
        const input = document.getElementById(`transform-${axis}`);
        if (input) input.value = currentModel.position[axis].toFixed(2);
    });
}

// ─── Material Sliders ──────────────────────────────────────────────────────────
function bindMaterialSliders() {
    const roughInput = document.getElementById('mat-roughness');
    const metalInput = document.getElementById('mat-metalness');
    const roughVal = document.getElementById('mat-roughness-val');
    const metalVal = document.getElementById('mat-metalness-val');

    const applyMaterial = () => {
        if (!currentModel) return;
        currentModel.traverse(child => {
            if (child.isMesh && child.material) {
                child.material.roughness = parseFloat(roughInput.value);
                child.material.metalness = parseFloat(metalInput.value);
                child.material.needsUpdate = true;
            }
        });
    };

    roughInput?.addEventListener('input', () => {
        if (roughVal) roughVal.textContent = parseFloat(roughInput.value).toFixed(2);
        applyMaterial();
    });

    metalInput?.addEventListener('input', () => {
        if (metalVal) metalVal.textContent = parseFloat(metalInput.value).toFixed(2);
        applyMaterial();
    });
}

// ─── Scene Graph ───────────────────────────────────────────────────────────────
function addToSceneGraph() {
    const list = document.getElementById('scene-graph-list');
    const count = list.querySelectorAll('.scene-item').length + 1;
    const name = `Forged_Mesh_${String(count).padStart(2, '0')}`;

    list.querySelectorAll('.scene-item').forEach(el => {
        el.classList.remove('bg-primary/5', 'border-l-2', 'border-primary');
        el.classList.add('hover:bg-surface-container-high', 'transition-colors');
    });

    list.querySelector('.empty-placeholder')?.remove();

    const item = document.createElement('div');
    item.className = 'scene-item group flex items-center gap-2 p-2 rounded-lg bg-primary/5 border-l-2 border-primary';
    item.innerHTML = `
        <span class="material-symbols-outlined text-primary text-sm">view_in_ar</span>
        <span class="text-sm font-label text-on-surface">${name}</span>
        <span class="material-symbols-outlined text-[16px] ml-auto text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" title="Toggle Visibility">visibility</span>
    `;

    item.querySelector('span[title="Toggle Visibility"]').addEventListener('click', e => {
        e.stopPropagation();
        if (currentModel) {
            currentModel.visible = !currentModel.visible;
            e.currentTarget.textContent = currentModel.visible ? 'visibility' : 'visibility_off';
        }
    });

    list.prepend(item);
}

function addToHistory(action) {
    const list = document.getElementById('history-list');
    list.querySelector('.empty-history')?.remove();

    const item = document.createElement('div');
    item.className = 'flex items-center gap-2';
    item.innerHTML = `
        <div class="w-1.5 h-1.5 rounded-full bg-secondary-dim flex-shrink-0"></div>
        <span class="text-xs text-on-surface-variant italic">${action} (just now)</span>
    `;
    list.prepend(item);
    while (list.children.length > 5) list.removeChild(list.lastChild);
}

// ─── Status Bar ────────────────────────────────────────────────────────────────
function setStatus(state, text) {
    const dot = document.getElementById('status-dot');
    const textEl = document.getElementById('status-text');
    if (textEl) textEl.textContent = text;
    if (!dot) return;
    dot.className = 'w-1.5 h-1.5 rounded-full';
    switch (state) {
        case 'ready':   dot.classList.add('bg-secondary', 'animate-pulse'); break;
        case 'busy':
        case 'loading': dot.classList.add('bg-yellow-400', 'animate-pulse'); break;
        case 'error':   dot.classList.add('bg-error'); break;
    }
}

// ─── Forge Button State ────────────────────────────────────────────────────────
function setForgeState(state) {
    const btn = document.getElementById('forge-btn');
    if (!btn) return;
    if (state === 'loading') {
        btn.disabled = true;
        btn.innerHTML = `
            <svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
            </svg>
            Forging…`;
    } else {
        btn.disabled = false;
        btn.innerHTML = `Forge <span class="material-symbols-outlined text-[18px]">bolt</span>`;
    }
}
