import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// --- App State ---
let socket, sessionId;
let scene, camera, renderer, controls, gridHelper;
let currentModel = null;
let currentModelUrl = null;
let currentGenerationId = null;
let isWireframe = false;
let generations = [];
let selectedQuality = 'balanced';

const stepsMap = { fast: 32, balanced: 64, quality: 128 };

// --- Boot ---
document.addEventListener('DOMContentLoaded', async () => {
    await verifyAuth();
    initSocketio();
    initViewport();
    bindForgeButton();
    bindQualityToggles();
    bindViewportControls();
    bindExportButton();
    bindLogout();
    bindHistorySearch();
    bindTabSwitching();
    bindImageUpload();
    await loadGenerations();
});

// --- Auth ---
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
        document.getElementById('user-name').textContent = name + "'s Workspace";
        document.getElementById('user-initials').textContent = initials;
        const sidebarName = document.getElementById('sidebar-user-name');
        if (sidebarName) sidebarName.textContent = name;
    } catch {
        window.location.replace('/auth/index.html');
    }
}

// --- Socket.IO ---
function initSocketio() {
    sessionId = sessionStorage.getItem('xemy_session') || crypto.randomUUID();
    sessionStorage.setItem('xemy_session', sessionId);

    socket = io();
    socket.on('connect', () => socket.emit('register_session', sessionId));

    socket.on('generation_status', ({ status }) => {
        const messages = {
            IN_QUEUE:    'In queue \u2014 waiting for GPU...',
            IN_PROGRESS: 'Generating model...',
        };
        setStatus('busy', messages[status] || `Status: ${status}`);
    });

    socket.on('generation_complete', ({ modelUrl, generationId, prompt, name, thumbnail }) => {
        currentModelUrl = modelUrl;
        currentGenerationId = generationId;
        setStatus('loading', 'Downloading model...');
        loadModel(modelUrl, () => {
            // Add to history panel using backend-generated thumbnail
            addToHistoryPanel({ _id: generationId, prompt, name, modelUrl, thumbnail: thumbnail || '', createdAt: new Date().toISOString() });
        });
    });

    socket.on('generation_failed', ({ error }) => {
        setStatus('error', `Failed: ${error}`);
        setForgeState('idle');
    });
}

// --- Three.js Viewport ---
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

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 1000);
    camera.position.set(0, 2, 5);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    // Key light (warm, from top-right)
    const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.8);
    keyLight.position.set(4, 6, 4);
    scene.add(keyLight);

    // Fill light (cool, from left)
    const fillLight = new THREE.DirectionalLight(0xcce0ff, 0.6);
    fillLight.position.set(-4, 2, -2);
    scene.add(fillLight);

    // Rim / back light (subtle accent)
    const rimLight = new THREE.DirectionalLight(0xcf96ff, 0.4);
    rimLight.position.set(0, 3, -5);
    scene.add(rimLight);

    // Hemisphere light for natural sky/ground gradient
    const hemiLight = new THREE.HemisphereLight(0xc8d8ff, 0x3a2a1a, 0.4);
    scene.add(hemiLight);

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

function loadModel(url, onComplete) {
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
                color: 0xd4d4d4,
                metalness: 0.15,
                roughness: 0.55,
                envMapIntensity: 0.5,
            });
            obj.traverse(child => {
                if (child.isMesh) child.material = mat;
            });

            scene.add(obj);
            currentModel = obj;
            isWireframe = false;

            updateModelStats();
            document.getElementById('viewport-empty')?.classList.add('hidden');
            document.getElementById('model-stats')?.classList.remove('hidden');

            setStatus('ready', 'Ready to generate');
            setForgeState('idle');
            showViewportLoader(false);

            if (typeof onComplete === 'function') onComplete();
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

function updateModelStats() {
    if (!currentModel) return;
    let faces = 0, vertices = 0;
    currentModel.traverse(child => {
        if (child.isMesh && child.geometry) {
            const geo = child.geometry;
            vertices += geo.attributes.position ? geo.attributes.position.count : 0;
            if (geo.index) {
                faces += geo.index.count / 3;
            } else if (geo.attributes.position) {
                faces += geo.attributes.position.count / 3;
            }
        }
    });
    const fmt = n => n.toLocaleString();
    document.getElementById('stat-faces').textContent = fmt(Math.floor(faces));
    document.getElementById('stat-vertices').textContent = fmt(Math.floor(vertices));
}

// --- Tab Switching ---
function bindTabSwitching() {
    const panels = { text: document.getElementById('tab-text'), image: document.getElementById('tab-image') };
    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab;
            Object.entries(panels).forEach(([key, el]) => {
                if (!el) return;
                if (key === target) {
                    el.classList.remove('hidden');
                    el.classList.add('flex');
                } else {
                    el.classList.remove('flex');
                    el.classList.add('hidden');
                }
            });
        });
    });
}

// --- Image Upload ---
function bindImageUpload() {
    const dropZone = document.getElementById('image-drop-zone');
    const fileInput = document.getElementById('image-file-input');
    const preview = document.getElementById('image-preview');
    const previewContainer = document.getElementById('image-preview-container');
    const uploadPrompt = document.getElementById('image-upload-prompt');
    const clearBtn = document.getElementById('image-clear-btn');
    const imgForgeBtn = document.getElementById('img-forge-btn');

    if (!dropZone) return;

    let selectedImageFile = null;

    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files?.[0]) handleImageFile(e.target.files[0]);
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files?.[0]) handleImageFile(e.dataTransfer.files[0]);
    });

    // Paste support
    document.addEventListener('paste', (e) => {
        const activeTab = document.querySelector('.mode-tab.active')?.dataset.tab;
        if (activeTab !== 'image') return;
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                handleImageFile(item.getAsFile());
                break;
            }
        }
    });

    clearBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedImageFile = null;
        previewContainer.classList.add('hidden');
        uploadPrompt.classList.remove('hidden');
        fileInput.value = '';
    });

    function handleImageFile(file) {
        if (!file || file.size > 20 * 1024 * 1024) {
            setStatus('error', 'Image too large (max 20MB)');
            return;
        }
        selectedImageFile = file;
        const reader = new FileReader();
        reader.onload = (ev) => {
            preview.src = ev.target.result;
            previewContainer.classList.remove('hidden');
            uploadPrompt.classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }

    imgForgeBtn?.addEventListener('click', () => {
        if (!selectedImageFile) {
            setStatus('error', 'Please upload a reference image first');
            return;
        }
        // Image-to-3D is a UI placeholder — backend not implemented yet
        setStatus('error', 'Image to 3D coming soon!');
    });
}

// --- Quality Toggles ---
function bindQualityToggles() {
    document.querySelectorAll('.quality-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.quality-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedQuality = btn.dataset.quality;
        });
    });
}

// --- Forge ---
function bindForgeButton() {
    document.getElementById('forge-btn').addEventListener('click', forge);
    document.getElementById('prompt-input').addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.ctrlKey) forge();
    });
}

async function forge() {
    const prompt = document.getElementById('prompt-input').value.trim();
    if (!prompt) {
        document.getElementById('prompt-input').focus();
        return;
    }

    const name = document.getElementById('gen-name')?.value.trim() || '';
    const steps = stepsMap[selectedQuality] ?? 64;

    setForgeState('loading');
    setStatus('busy', 'Submitting to forge...');

    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, name, sessionId, steps }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Request failed');
        }
        const data = await res.json();
        setStatus('busy', `Forging \u2014 Job ${(data.jobId || '').slice(0, 8) || '...'}`);
    } catch (err) {
        setStatus('error', err.message);
        setForgeState('idle');
    }
}

// --- Export ---
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

// --- Logout ---
function bindLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.replace('/auth/index.html');
    });
}

// --- Viewport Controls ---
function bindViewportControls() {
    document.getElementById('ctrl-camera').addEventListener('click', () => {
        camera.position.set(0, 2, 5);
        controls.target.set(0, 0, 0);
        controls.update();
    });

    document.getElementById('ctrl-grid').addEventListener('click', () => {
        gridHelper.visible = !gridHelper.visible;
    });

    document.getElementById('ctrl-wireframe').addEventListener('click', () => {
        if (!currentModel) return;
        isWireframe = !isWireframe;
        currentModel.traverse(child => {
            if (child.isMesh) {
                if (isWireframe) {
                    child.material = new THREE.MeshBasicMaterial({ color: 0xb8f147, wireframe: true });
                } else {
                    child.material = new THREE.MeshStandardMaterial({ color: 0xd4d4d4, metalness: 0.15, roughness: 0.55 });
                }
            }
        });
    });

    document.getElementById('ctrl-material').addEventListener('click', () => {
        if (!currentModel) return;
        // Cycle through material colors
        const colors = [0xb8f147, 0xcf96ff, 0x00eefc, 0xff59e3, 0xffffff, 0xff6e84];
        const current = currentModel.userData.colorIndex || 0;
        const next = (current + 1) % colors.length;
        currentModel.userData.colorIndex = next;
        currentModel.traverse(child => {
            if (child.isMesh) {
                child.material.color.setHex(colors[next]);
                child.material.needsUpdate = true;
            }
        });
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

// --- Generation History ---
async function loadGenerations() {
    try {
        const res = await fetch('/api/generations');
        if (!res.ok) return;
        generations = await res.json();
        renderHistory(generations);
    } catch (e) {
        console.error('Failed to load generations:', e);
    }
}

function renderHistory(items) {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');

    // Clear all gen-cards but keep the empty state
    list.querySelectorAll('.gen-card').forEach(el => el.remove());

    if (items.length === 0) {
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 gap-3';

    items.forEach(gen => {
        grid.appendChild(createHistoryCard(gen));
    });

    list.appendChild(grid);
}

function createHistoryCard(gen) {
    const card = document.createElement('div');
    card.className = 'gen-card group rounded-xl border border-outline-variant/20 bg-surface-container-high overflow-hidden cursor-pointer transition-all duration-200 hover:border-lime/50 hover:-translate-y-px [&.active]:border-lime [&.active]:shadow-[0_0_12px_rgba(184,241,71,0.15)]';
    card.dataset.id = gen._id;
    if (gen._id === currentGenerationId) card.classList.add('active');

    const thumbUrl = gen.thumbnail || '';
    const timeAgo = formatTimeAgo(gen.createdAt);
    const displayName = gen.name || gen.prompt;

    card.innerHTML = `
        <div class="aspect-square bg-surface-container relative overflow-hidden">
            ${thumbUrl
                ? `<img src="${thumbUrl}" class="w-full h-full object-cover" alt="" />`
                : `<div class="w-full h-full flex items-center justify-center"><span class="material-symbols-outlined text-2xl text-on-surface-variant/20">view_in_ar</span></div>`
            }
            <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                <button class="delete-gen-btn p-1 rounded bg-error/80 hover:bg-error transition-colors" title="Delete">
                    <span class="material-symbols-outlined text-sm text-white">delete</span>
                </button>
            </div>
        </div>
        <div class="p-2.5">
            <p class="text-[11px] text-on-surface font-medium truncate">${escapeHtml(displayName)}</p>
            <p class="text-[9px] text-on-surface-variant/60 mt-0.5 font-label">${timeAgo}</p>
        </div>
    `;

    // Click to load model
    card.addEventListener('click', (e) => {
        if (e.target.closest('.delete-gen-btn')) return;
        currentModelUrl = gen.modelUrl;
        currentGenerationId = gen._id;
        // Highlight active card
        document.querySelectorAll('.gen-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        setStatus('loading', 'Loading model...');
        loadModel(gen.modelUrl);
        // Set prompt in input
        document.getElementById('prompt-input').value = gen.prompt || '';
        document.getElementById('gen-name').value = gen.name || '';
    });

    // Delete button
    card.querySelector('.delete-gen-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteGeneration(gen._id);
    });

    return card;
}

function addToHistoryPanel(gen) {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    if (empty) empty.classList.add('hidden');

    // Check if grid exists
    let grid = list.querySelector('.grid');
    if (!grid) {
        grid = document.createElement('div');
        grid.className = 'grid grid-cols-2 gap-3';
        list.appendChild(grid);
    }

    // Add card at the beginning
    const card = createHistoryCard(gen);
    grid.prepend(card);

    // Update local array
    generations.unshift(gen);
}

async function deleteGeneration(id) {
    try {
        const res = await fetch(`/api/generations/${id}`, { method: 'DELETE' });
        if (!res.ok) return;
        // Remove from local array
        generations = generations.filter(g => g._id !== id);
        // Re-render
        const list = document.getElementById('history-list');
        list.querySelectorAll('.gen-card').forEach(el => el.remove());
        const grid = list.querySelector('.grid');
        if (grid) grid.remove();
        renderHistory(generations);
        // If deleted model is currently displayed, clear it
        if (currentGenerationId === id) {
            if (currentModel) scene.remove(currentModel);
            currentModel = null;
            currentModelUrl = null;
            currentGenerationId = null;
            document.getElementById('viewport-empty')?.classList.remove('hidden');
            document.getElementById('model-stats')?.classList.add('hidden');
        }
    } catch (e) {
        console.error('Failed to delete generation:', e);
    }
}

// --- History Search ---
function bindHistorySearch() {
    const input = document.getElementById('history-search');
    const refreshBtn = document.getElementById('refresh-history-btn');

    input?.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) {
            renderFilteredHistory(generations);
            return;
        }
        const filtered = generations.filter(g =>
            (g.prompt || '').toLowerCase().includes(q) || (g.name || '').toLowerCase().includes(q)
        );
        renderFilteredHistory(filtered);
    });

    refreshBtn?.addEventListener('click', loadGenerations);
}

function renderFilteredHistory(items) {
    const list = document.getElementById('history-list');
    list.querySelectorAll('.gen-card').forEach(el => el.remove());
    const grid = list.querySelector('.grid');
    if (grid) grid.remove();
    renderHistory(items);
}

// --- Status Bar ---
function setStatus(state, text) {
    const dot = document.getElementById('status-dot');
    const textEl = document.getElementById('status-text');
    if (textEl) textEl.textContent = text;
    if (!dot) return;
    dot.className = 'w-1.5 h-1.5 rounded-full';
    switch (state) {
        case 'ready':   dot.classList.add('bg-lime', 'animate-pulse'); break;
        case 'busy':
        case 'loading': dot.classList.add('bg-yellow-400', 'animate-pulse'); break;
        case 'error':   dot.classList.add('bg-error'); break;
    }
}

// --- Forge Button State ---
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
            Forging\u2026`;
    } else {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-outlined text-lg">auto_awesome</span> Generate`;
    }
}

// --- Helpers ---
function formatTimeAgo(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
