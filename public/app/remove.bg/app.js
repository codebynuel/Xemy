// --- Auth + Credits ---
let userCredits = 0;
let creditCosts = {};

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/verify');
        const data = await res.json();
        if (!data.authenticated) { window.location.href = '/auth/'; return; }
        const user = data.user;
        document.getElementById('user-initials').textContent = (user.name?.[0] || user.email[0]).toUpperCase();
        document.getElementById('sidebar-user-name').textContent = user.name || user.email;
        userCredits = data.credits;
        creditCosts = data.costs || {};
        updateCreditUI();
    } catch { window.location.href = '/auth/'; }
}

function updateCreditUI() {
    document.getElementById('credit-balance').textContent = `${userCredits} credits`;
    const cost = creditCosts.removeBg || 5;
    document.getElementById('cost-label').textContent = `${cost} credits`;
}

document.addEventListener('click', (e) => {
    if (e.target.closest('#logout-btn')) {
        e.preventDefault();
        fetch('/api/auth/logout', { method: 'POST' }).then(() => {
            window.location.href = '/auth/';
        });
    }
});

// --- Image Upload ---
let uploadedImageUrl = null;
let originalPreviewSrc = null;
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewContainer = document.getElementById('preview-container');
const imagePreview = document.getElementById('image-preview');
const uploadPrompt = document.getElementById('upload-prompt');
const clearBtn = document.getElementById('clear-btn');
const processBtn = document.getElementById('process-btn');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });

// Paste support
document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            handleFile(item.getAsFile());
            break;
        }
    }
});

clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetUpload();
});

function resetUpload() {
    uploadedImageUrl = null;
    originalPreviewSrc = null;
    fileInput.value = '';
    previewContainer.classList.add('hidden');
    uploadPrompt.classList.remove('hidden');
    processBtn.disabled = true;
    setStatus('idle', 'Upload an image to start');
}

async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 20 * 1024 * 1024) { setStatus('error', 'File too large (max 20MB)'); return; }

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (e) => {
        imagePreview.src = e.target.result;
        originalPreviewSrc = e.target.result;
        previewContainer.classList.remove('hidden');
        uploadPrompt.classList.add('hidden');
    };
    reader.readAsDataURL(file);

    // Upload to server
    setStatus('busy', 'Uploading...');
    try {
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch('/api/remove-bg/upload', { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Upload failed');
        }
        const data = await res.json();
        uploadedImageUrl = data.imageUrl;
        processBtn.disabled = false;
        setStatus('ready', 'Ready — click Remove Background');
    } catch (err) {
        setStatus('error', err.message);
        resetUpload();
    }
}

// --- Processing ---
processBtn.addEventListener('click', async () => {
    if (!uploadedImageUrl) return;

    const cost = creditCosts.removeBg || 5;
    if (userCredits < cost) {
        setStatus('error', `Not enough credits (need ${cost}, have ${userCredits})`);
        return;
    }

    processBtn.disabled = true;
    document.getElementById('loader').classList.remove('hidden');
    document.getElementById('empty-state').classList.add('hidden');
    setStatus('busy', 'Removing background...');

    try {
        const res = await fetch('/api/remove-bg/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: uploadedImageUrl })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Processing failed');

        if (data.credits !== undefined) { userCredits = data.credits; updateCreditUI(); }

        showResult(originalPreviewSrc, data.resultUrl);
        addToHistory(originalPreviewSrc, data.resultUrl);
        setStatus('ready', 'Done! Download your result or try another image');
    } catch (err) {
        setStatus('error', err.message);
        document.getElementById('empty-state').classList.remove('hidden');
    } finally {
        processBtn.disabled = false;
        document.getElementById('loader').classList.add('hidden');
    }
});

// --- Result Display ---
let currentResultUrl = null;
let currentOriginalSrc = null;
let viewMode = 'compare'; // 'compare' | 'result' | 'edit'

function showResult(originalSrc, resultUrl) {
    currentResultUrl = resultUrl;
    currentOriginalSrc = originalSrc;

    const resultView = document.getElementById('result-view');
    const resultImg = document.getElementById('result-img');
    const originalOverlay = document.getElementById('original-overlay');
    const toolbar = document.getElementById('toolbar');

    resultImg.src = resultUrl;
    originalOverlay.src = originalSrc;

    resultView.classList.remove('hidden');
    toolbar.classList.remove('hidden');
    document.getElementById('empty-state').classList.add('hidden');

    // Auto-enter edit mode so eraser/restorer tools are immediately visible
    enterEditMode();
}

// --- Before/After Compare Slider ---
let _sliderAbort = null;
let _sliderPct = 0;

function initCompareSlider() {
    // Tear down previous listeners
    if (_sliderAbort) _sliderAbort.abort();
    _sliderAbort = new AbortController();
    const signal = _sliderAbort.signal;

    const container = document.getElementById('compare-container');
    const overlay = document.getElementById('compare-overlay');
    const handle = document.getElementById('compare-handle');

    function setSliderPosition(pct) {
        _sliderPct = pct;
        const w = container.offsetWidth;
        if (w === 0) return;
        const clipRight = (1 - pct) * 100;
        overlay.style.clipPath = `inset(0 ${clipRight}% 0 0)`;
        handle.style.left = (w * pct) + 'px';
    }

    setSliderPosition(_sliderPct);

    let dragging = false;
    const onMove = (e) => {
        if (!dragging) return;
        const rect = container.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        setSliderPosition(pct);
    };

    container.addEventListener('mousedown', (e) => { dragging = true; onMove(e); }, { signal });
    container.addEventListener('touchstart', (e) => { dragging = true; onMove(e); }, { passive: true, signal });
    window.addEventListener('mousemove', onMove, { signal });
    window.addEventListener('touchmove', onMove, { passive: true, signal });
    window.addEventListener('mouseup', () => { dragging = false; }, { signal });
    window.addEventListener('touchend', () => { dragging = false; }, { signal });
    window.addEventListener('resize', () => setSliderPosition(_sliderPct), { signal });
}

// --- Toolbar ---
document.getElementById('btn-compare').addEventListener('click', () => {
    if (viewMode === 'edit') exitEditMode();
    viewMode = 'compare';
    document.getElementById('compare-overlay').classList.remove('hidden');
    document.getElementById('compare-handle').classList.remove('hidden');
    _sliderPct = 0.5;
    requestAnimationFrame(() => initCompareSlider());
    updateToolbarButtons();
});

document.getElementById('btn-result-only').addEventListener('click', () => {
    if (viewMode === 'edit') exitEditMode();
    viewMode = 'result';
    document.getElementById('compare-container').classList.remove('hidden');
    document.getElementById('edit-container').classList.add('hidden');
    document.getElementById('compare-overlay').classList.add('hidden');
    document.getElementById('compare-handle').classList.add('hidden');
    updateToolbarButtons();
});

document.getElementById('btn-edit').addEventListener('click', () => {
    if (viewMode !== 'edit') enterEditMode();
});

document.getElementById('btn-apply').addEventListener('click', () => {
    applyEdits();
});

function updateToolbarButtons() {
    const compareBtn = document.getElementById('btn-compare');
    const resultBtn = document.getElementById('btn-result-only');
    const editBtn = document.getElementById('btn-edit');
    const applyBtn = document.getElementById('btn-apply');
    const editSep = document.getElementById('edit-toolbar-sep');
    const isEdit = viewMode === 'edit';

    const activeCls = 'bg-lime/20 text-lime';
    const inactiveCls = 'hover:bg-lime/15 text-on-surface-variant hover:text-on-surface';

    [compareBtn, resultBtn, editBtn].forEach(btn => {
        btn.className = btn.className.replace(/bg-lime\/20 text-lime|hover:bg-lime\/15 text-on-surface-variant hover:text-on-surface/g, '').trim();
    });

    if (viewMode === 'compare') { compareBtn.className += ' ' + activeCls; resultBtn.className += ' ' + inactiveCls; editBtn.className += ' ' + inactiveCls; }
    else if (viewMode === 'result') { resultBtn.className += ' ' + activeCls; compareBtn.className += ' ' + inactiveCls; editBtn.className += ' ' + inactiveCls; }
    else { editBtn.className += ' ' + activeCls; compareBtn.className += ' ' + inactiveCls; resultBtn.className += ' ' + inactiveCls; }

    applyBtn.classList.toggle('hidden', !isEdit);
    editSep.classList.toggle('hidden', !isEdit);
}

document.getElementById('btn-download').addEventListener('click', () => {
    if (viewMode === 'edit' && editState.maskCanvas) {
        // Download composited result from edit canvas
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = editState.imgW;
        exportCanvas.height = editState.imgH;
        const ctx = exportCanvas.getContext('2d');
        renderToCanvas(ctx, editState.imgW, editState.imgH);
        const a = document.createElement('a');
        a.href = exportCanvas.toDataURL('image/png');
        a.download = `xemy-nobg-${Date.now()}.png`;
        a.click();
    } else if (currentResultUrl) {
        const a = document.createElement('a');
        a.href = currentResultUrl;
        a.download = `xemy-nobg-${Date.now()}.png`;
        a.click();
    }
});

// --- History (persisted to localStorage) ---
const HISTORY_KEY = 'xemy_removebg_history';
const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');

function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
}

function addToHistory(originalSrc, resultUrl) {
    history.unshift({ originalSrc, resultUrl, timestamp: Date.now() });
    if (history.length > 20) history.pop();
    saveHistory();
    renderHistory();
}

function renderHistory() {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');

    if (!history.length) {
        empty.classList.remove('hidden');
        list.querySelectorAll('.history-card').forEach(c => c.remove());
        return;
    }
    empty.classList.add('hidden');

    // Remove old cards
    list.querySelectorAll('.history-card').forEach(c => c.remove());

    for (const item of history) {
        const card = document.createElement('div');
        card.className = 'history-card group relative rounded-xl overflow-hidden border border-outline-variant/15 cursor-pointer hover:border-lime/30 transition-colors';
        card.innerHTML = `
            <div class="flex gap-2 p-2">
                <img src="${item.originalSrc}" class="w-16 h-16 rounded-lg object-cover bg-surface-container-high" />
                <img src="${item.resultUrl}" class="w-16 h-16 rounded-lg object-contain checkerboard" />
            </div>
            <div class="px-2 pb-2">
                <span class="text-[10px] text-on-surface-variant/60 font-label">${new Date(item.timestamp).toLocaleTimeString()}</span>
            </div>
        `;
        card.addEventListener('click', () => showResult(item.originalSrc, item.resultUrl));
        list.appendChild(card);
    }
}

// --- Status ---
function setStatus(type, text) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-text');
    label.textContent = text;

    dot.className = 'w-1.5 h-1.5 rounded-full';
    if (type === 'idle') { dot.classList.add('bg-on-surface-variant/50'); }
    else if (type === 'ready') { dot.classList.add('bg-lime', 'animate-pulse'); }
    else if (type === 'busy') { dot.classList.add('bg-secondary', 'animate-pulse'); }
    else if (type === 'error') { dot.classList.add('bg-error'); }
}

// ============================================================
// --- Edit Mode: Eraser/Restorer + Background Tools ---
// ============================================================

const editState = {
    active: false,
    tool: 'eraser', // 'eraser' | 'restorer'
    brushSize: 30,
    brushHardness: 80,
    brushOpacity: 100,
    bgMode: 'transparent', // 'transparent' | 'solid' | 'gradient' | 'image'
    bgSolidColor: '#ffffff',
    bgGradColor1: '#667eea',
    bgGradColor2: '#764ba2',
    bgGradAngle: 135,
    bgImage: null,
    bgFit: 'cover', // 'cover' | 'contain'
    // Canvas state
    maskCanvas: null,
    maskCtx: null,
    originalImg: null,
    resultImg: null,
    imgW: 0,
    imgH: 0,
    // Brush stamp cache
    stampCanvas: null,
    stampDirty: true,
    // Drawing state
    drawing: false,
    lastX: 0,
    lastY: 0,
    // Undo
    undoStack: [],
    redoStack: [],
};

function loadImageAsync(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

async function enterEditMode() {
    if (!currentResultUrl || !currentOriginalSrc) return;
    viewMode = 'edit';
    editState.active = true;

    // Load images
    const [resultImg, originalImg] = await Promise.all([
        loadImageAsync(currentResultUrl),
        loadImageAsync(currentOriginalSrc)
    ]);
    editState.resultImg = resultImg;
    editState.originalImg = originalImg;
    editState.imgW = resultImg.naturalWidth;
    editState.imgH = resultImg.naturalHeight;

    // Init mask from result alpha
    editState.maskCanvas = document.createElement('canvas');
    editState.maskCanvas.width = editState.imgW;
    editState.maskCanvas.height = editState.imgH;
    editState.maskCtx = editState.maskCanvas.getContext('2d', { willReadFrequently: true });

    // Draw result to extract alpha → mask alpha channel controls visibility
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = editState.imgW;
    tempCanvas.height = editState.imgH;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    tempCtx.drawImage(resultImg, 0, 0);
    const imgData = tempCtx.getImageData(0, 0, editState.imgW, editState.imgH);
    const maskData = editState.maskCtx.createImageData(editState.imgW, editState.imgH);
    for (let i = 0; i < imgData.data.length; i += 4) {
        const a = imgData.data[i + 3];
        maskData.data[i] = 255;       // R
        maskData.data[i + 1] = 255;   // G
        maskData.data[i + 2] = 255;   // B
        maskData.data[i + 3] = a;     // A = foreground alpha
    }
    editState.maskCtx.putImageData(maskData, 0, 0);

    // Reset undo
    editState.undoStack = [];
    editState.redoStack = [];
    pushUndo();

    // Show edit canvas, hide compare
    document.getElementById('compare-container').classList.add('hidden');
    document.getElementById('edit-container').classList.remove('hidden');

    // Size canvases
    const editCanvas = document.getElementById('edit-canvas');
    const cursorCanvas = document.getElementById('cursor-canvas');
    editCanvas.width = editState.imgW;
    editCanvas.height = editState.imgH;
    cursorCanvas.width = editCanvas.offsetWidth;
    cursorCanvas.height = editCanvas.offsetHeight;

    // Show brush/bg tools
    document.getElementById('brush-tools').classList.remove('hidden');
    document.getElementById('bg-tools').classList.remove('hidden');

    editState.stampDirty = true;
    renderComposite();
    updateToolbarButtons();
    setStatus('ready', 'Edit mode — erase or restore areas');
}

function exitEditMode() {
    editState.active = false;
    document.getElementById('compare-container').classList.remove('hidden');
    document.getElementById('edit-container').classList.add('hidden');
    document.getElementById('brush-tools').classList.add('hidden');
    document.getElementById('bg-tools').classList.add('hidden');
}

function applyEdits() {
    if (!editState.maskCanvas) return;
    // Render final to offscreen canvas and convert to data URL
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = editState.imgW;
    exportCanvas.height = editState.imgH;
    const ctx = exportCanvas.getContext('2d');
    renderToCanvas(ctx, editState.imgW, editState.imgH);
    const dataUrl = exportCanvas.toDataURL('image/png');

    // Update current result
    currentResultUrl = dataUrl;
    document.getElementById('result-img').src = dataUrl;

    // Exit edit mode to compare
    exitEditMode();
    viewMode = 'compare';
    document.getElementById('compare-overlay').classList.remove('hidden');
    document.getElementById('compare-handle').classList.remove('hidden');
    _sliderPct = 0.5;
    requestAnimationFrame(() => initCompareSlider());
    updateToolbarButtons();
    setStatus('ready', 'Edits applied! Download or continue editing');
}

// --- Compositing ---
function renderToCanvas(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);

    // Draw background
    if (editState.bgMode === 'solid') {
        ctx.fillStyle = editState.bgSolidColor;
        ctx.fillRect(0, 0, w, h);
    } else if (editState.bgMode === 'gradient') {
        const angle = editState.bgGradAngle * Math.PI / 180;
        const cx = w / 2, cy = h / 2;
        const len = Math.max(w, h);
        const x0 = cx - Math.cos(angle) * len / 2;
        const y0 = cy - Math.sin(angle) * len / 2;
        const x1 = cx + Math.cos(angle) * len / 2;
        const y1 = cy + Math.sin(angle) * len / 2;
        const grad = ctx.createLinearGradient(x0, y0, x1, y1);
        grad.addColorStop(0, editState.bgGradColor1);
        grad.addColorStop(1, editState.bgGradColor2);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    } else if (editState.bgMode === 'image' && editState.bgImage) {
        const img = editState.bgImage;
        if (editState.bgFit === 'cover') {
            const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
            const sw = img.naturalWidth * scale, sh = img.naturalHeight * scale;
            ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
        } else {
            const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
            const sw = img.naturalWidth * scale, sh = img.naturalHeight * scale;
            ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
        }
    }
    // transparent: nothing drawn, alpha preserved

    // Composite foreground: original × mask
    const fgCanvas = document.createElement('canvas');
    fgCanvas.width = w;
    fgCanvas.height = h;
    const fgCtx = fgCanvas.getContext('2d');
    fgCtx.drawImage(editState.originalImg, 0, 0, w, h);
    fgCtx.globalCompositeOperation = 'destination-in';
    fgCtx.drawImage(editState.maskCanvas, 0, 0, w, h);

    ctx.drawImage(fgCanvas, 0, 0);
}

function renderComposite() {
    if (!editState.active) return;
    const canvas = document.getElementById('edit-canvas');
    const ctx = canvas.getContext('2d');
    renderToCanvas(ctx, editState.imgW, editState.imgH);
}

// --- Brush Stamp ---
function generateBrushStamp() {
    const size = editState.brushSize;
    const hardness = editState.brushHardness / 100;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, r * hardness, r, r, r);
    grad.addColorStop(0, 'white');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    editState.stampCanvas = c;
    editState.stampDirty = false;
}

function getStamp() {
    if (editState.stampDirty || !editState.stampCanvas) generateBrushStamp();
    return editState.stampCanvas;
}

// --- Drawing ---
function canvasToImage(e) {
    const canvas = document.getElementById('edit-canvas');
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = (clientX - rect.left) / rect.width * editState.imgW;
    const y = (clientY - rect.top) / rect.height * editState.imgH;
    return { x, y };
}

function stampAt(x, y) {
    const stamp = getStamp();
    const s = editState.brushSize;
    const ctx = editState.maskCtx;
    ctx.save();
    ctx.globalAlpha = editState.brushOpacity / 100;
    ctx.globalCompositeOperation = editState.tool === 'eraser' ? 'destination-out' : 'lighter';
    ctx.drawImage(stamp, x - s / 2, y - s / 2, s, s);
    ctx.restore();
}

function strokeTo(x, y) {
    const dx = x - editState.lastX;
    const dy = y - editState.lastY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const spacing = Math.max(editState.brushSize * 0.2, 1);
    const steps = Math.max(Math.floor(dist / spacing), 1);

    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        stampAt(editState.lastX + dx * t, editState.lastY + dy * t);
    }
    editState.lastX = x;
    editState.lastY = y;
    renderComposite();
}

// Pointer events on edit canvas
const editCanvas = document.getElementById('edit-canvas');

editCanvas.addEventListener('mousedown', (e) => {
    if (!editState.active) return;
    editState.drawing = true;
    const { x, y } = canvasToImage(e);
    editState.lastX = x;
    editState.lastY = y;
    stampAt(x, y);
    renderComposite();
});

editCanvas.addEventListener('touchstart', (e) => {
    if (!editState.active) return;
    e.preventDefault();
    editState.drawing = true;
    const { x, y } = canvasToImage(e);
    editState.lastX = x;
    editState.lastY = y;
    stampAt(x, y);
    renderComposite();
});

window.addEventListener('mousemove', (e) => {
    if (editState.active) drawCursor(e);
    if (!editState.drawing) return;
    const { x, y } = canvasToImage(e);
    strokeTo(x, y);
});

window.addEventListener('touchmove', (e) => {
    if (!editState.drawing) return;
    const { x, y } = canvasToImage(e);
    strokeTo(x, y);
});

window.addEventListener('mouseup', () => {
    if (editState.drawing) { editState.drawing = false; pushUndo(); }
});

window.addEventListener('touchend', () => {
    if (editState.drawing) { editState.drawing = false; pushUndo(); }
});

// --- Brush Cursor Overlay ---
function drawCursor(e) {
    const cursorCanvas = document.getElementById('cursor-canvas');
    const ctx = cursorCanvas.getContext('2d');
    const rect = cursorCanvas.getBoundingClientRect();

    // Re-sync canvas size if needed
    if (cursorCanvas.width !== rect.width || cursorCanvas.height !== rect.height) {
        cursorCanvas.width = rect.width;
        cursorCanvas.height = rect.height;
    }

    ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Scale brush size to display coordinates
    const editCanvasEl = document.getElementById('edit-canvas');
    const editRect = editCanvasEl.getBoundingClientRect();
    const displayRadius = (editState.brushSize / 2) * (editRect.width / editState.imgW);

    // Outer circle (full size)
    ctx.beginPath();
    ctx.arc(cx, cy, displayRadius, 0, Math.PI * 2);
    ctx.strokeStyle = editState.tool === 'eraser' ? '#b8f147' : '#00eefc';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Inner circle (hardness)
    const innerR = displayRadius * (editState.brushHardness / 100);
    if (innerR > 1) {
        ctx.beginPath();
        ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
        ctx.strokeStyle = editState.tool === 'eraser' ? 'rgba(184,241,71,0.4)' : 'rgba(0,238,252,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = editState.tool === 'eraser' ? '#b8f147' : '#00eefc';
    ctx.fill();
}

// --- Undo / Redo ---
function pushUndo() {
    const data = editState.maskCtx.getImageData(0, 0, editState.imgW, editState.imgH);
    editState.undoStack.push(data);
    if (editState.undoStack.length > 25) editState.undoStack.shift();
    editState.redoStack = [];
}

function undo() {
    if (editState.undoStack.length < 2) return;
    editState.redoStack.push(editState.undoStack.pop());
    const data = editState.undoStack[editState.undoStack.length - 1];
    editState.maskCtx.putImageData(data, 0, 0);
    renderComposite();
}

function redo() {
    if (!editState.redoStack.length) return;
    const data = editState.redoStack.pop();
    editState.undoStack.push(data);
    editState.maskCtx.putImageData(data, 0, 0);
    renderComposite();
}

// --- Brush Controls Wiring ---
const brushSizeSlider = document.getElementById('brush-size');
const brushHardnessSlider = document.getElementById('brush-hardness');
const brushOpacitySlider = document.getElementById('brush-opacity');

brushSizeSlider.addEventListener('input', () => {
    editState.brushSize = parseInt(brushSizeSlider.value);
    editState.stampDirty = true;
    document.getElementById('brush-size-val').textContent = editState.brushSize + 'px';
});

brushHardnessSlider.addEventListener('input', () => {
    editState.brushHardness = parseInt(brushHardnessSlider.value);
    editState.stampDirty = true;
    document.getElementById('brush-hardness-val').textContent = editState.brushHardness + '%';
});

brushOpacitySlider.addEventListener('input', () => {
    editState.brushOpacity = parseInt(brushOpacitySlider.value);
    document.getElementById('brush-opacity-val').textContent = editState.brushOpacity + '%';
});

// Tool toggle
document.getElementById('tool-eraser').addEventListener('click', () => {
    editState.tool = 'eraser';
    updateToolToggle();
});

document.getElementById('tool-restorer').addEventListener('click', () => {
    editState.tool = 'restorer';
    updateToolToggle();
});

function updateToolToggle() {
    const eraserBtn = document.getElementById('tool-eraser');
    const restorerBtn = document.getElementById('tool-restorer');
    const activeCls = 'bg-lime/20 text-lime border-lime/30';
    const inactiveCls = 'hover:bg-surface-container-high text-on-surface-variant border-outline-variant/15';

    if (editState.tool === 'eraser') {
        eraserBtn.className = eraserBtn.className.replace(/bg-lime\/20 text-lime border-lime\/30|hover:bg-surface-container-high text-on-surface-variant border-outline-variant\/15/g, '').trim() + ' ' + activeCls;
        restorerBtn.className = restorerBtn.className.replace(/bg-lime\/20 text-lime border-lime\/30|hover:bg-surface-container-high text-on-surface-variant border-outline-variant\/15/g, '').trim() + ' ' + inactiveCls;
    } else {
        restorerBtn.className = restorerBtn.className.replace(/bg-lime\/20 text-lime border-lime\/30|hover:bg-surface-container-high text-on-surface-variant border-outline-variant\/15/g, '').trim() + ' ' + activeCls;
        eraserBtn.className = eraserBtn.className.replace(/bg-lime\/20 text-lime border-lime\/30|hover:bg-surface-container-high text-on-surface-variant border-outline-variant\/15/g, '').trim() + ' ' + inactiveCls;
    }
}

// --- Background Tools Wiring ---
const bgModeBtns = document.querySelectorAll('.bg-mode-btn');
const bgOptsMap = {
    transparent: null,
    solid: document.getElementById('bg-solid-opts'),
    gradient: document.getElementById('bg-gradient-opts'),
    image: document.getElementById('bg-image-opts'),
};

bgModeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        editState.bgMode = btn.dataset.bg;
        // Update button styles
        bgModeBtns.forEach(b => {
            b.className = b.className.replace(/bg-lime\/20 text-lime border-lime\/30|hover:bg-surface-container-high text-on-surface-variant border-outline-variant\/15/g, '').trim();
            if (b === btn) b.className += ' bg-lime/20 text-lime border-lime/30';
            else b.className += ' hover:bg-surface-container-high text-on-surface-variant border-outline-variant/15';
        });
        // Show/hide option panels
        Object.values(bgOptsMap).forEach(el => el && el.classList.add('hidden'));
        const opts = bgOptsMap[editState.bgMode];
        if (opts) opts.classList.remove('hidden');
        renderComposite();
    });
});

// Solid color
document.getElementById('bg-solid-color').addEventListener('input', (e) => {
    editState.bgSolidColor = e.target.value;
    renderComposite();
});

// Gradient
document.getElementById('bg-grad-color1').addEventListener('input', (e) => { editState.bgGradColor1 = e.target.value; renderComposite(); });
document.getElementById('bg-grad-color2').addEventListener('input', (e) => { editState.bgGradColor2 = e.target.value; renderComposite(); });
document.getElementById('bg-grad-angle').addEventListener('input', (e) => {
    editState.bgGradAngle = parseInt(e.target.value);
    document.getElementById('bg-grad-angle-val').textContent = editState.bgGradAngle + '°';
    renderComposite();
});

// Background image upload
const bgImageDrop = document.getElementById('bg-image-drop');
const bgImageInput = document.getElementById('bg-image-input');

bgImageDrop.addEventListener('click', () => bgImageInput.click());
bgImageDrop.addEventListener('dragover', (e) => e.preventDefault());
bgImageDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) loadBgImage(e.dataTransfer.files[0]);
});
bgImageInput.addEventListener('change', () => {
    if (bgImageInput.files.length) loadBgImage(bgImageInput.files[0]);
});

function loadBgImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            editState.bgImage = img;
            bgImageDrop.innerHTML = '<img src="' + e.target.result + '" class="max-h-16 rounded object-contain" />';
            renderComposite();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Fit toggle
document.getElementById('bg-fit-cover').addEventListener('click', () => {
    editState.bgFit = 'cover';
    document.getElementById('bg-fit-cover').className = document.getElementById('bg-fit-cover').className.replace(/hover:bg-surface-container-high text-on-surface-variant border-outline-variant\/15|bg-lime\/20 text-lime border-lime\/30/g, '') + ' bg-lime/20 text-lime border-lime/30';
    document.getElementById('bg-fit-contain').className = document.getElementById('bg-fit-contain').className.replace(/bg-lime\/20 text-lime border-lime\/30|hover:bg-surface-container-high text-on-surface-variant border-outline-variant\/15/g, '') + ' hover:bg-surface-container-high text-on-surface-variant border-outline-variant/15';
    renderComposite();
});

document.getElementById('bg-fit-contain').addEventListener('click', () => {
    editState.bgFit = 'contain';
    document.getElementById('bg-fit-contain').className = document.getElementById('bg-fit-contain').className.replace(/hover:bg-surface-container-high text-on-surface-variant border-outline-variant\/15|bg-lime\/20 text-lime border-lime\/30/g, '') + ' bg-lime/20 text-lime border-lime/30';
    document.getElementById('bg-fit-cover').className = document.getElementById('bg-fit-cover').className.replace(/bg-lime\/20 text-lime border-lime\/30|hover:bg-surface-container-high text-on-surface-variant border-outline-variant\/15/g, '') + ' hover:bg-surface-container-high text-on-surface-variant border-outline-variant/15';
    renderComposite();
});

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
    if (!editState.active) return;
    // Don't intercept when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'e' || e.key === 'E') {
        editState.tool = 'eraser';
        updateToolToggle();
    } else if (e.key === 'r' || e.key === 'R') {
        editState.tool = 'restorer';
        updateToolToggle();
    } else if (e.key === '[') {
        editState.brushSize = Math.max(1, editState.brushSize - 5);
        editState.stampDirty = true;
        brushSizeSlider.value = editState.brushSize;
        document.getElementById('brush-size-val').textContent = editState.brushSize + 'px';
    } else if (e.key === ']') {
        editState.brushSize = Math.min(200, editState.brushSize + 5);
        editState.stampDirty = true;
        brushSizeSlider.value = editState.brushSize;
        document.getElementById('brush-size-val').textContent = editState.brushSize + 'px';
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        redo();
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
    }
});

// --- Window Resize ---
window.addEventListener('resize', () => {
    if (!editState.active) return;
    const cursorCanvas = document.getElementById('cursor-canvas');
    const rect = cursorCanvas.getBoundingClientRect();
    cursorCanvas.width = rect.width;
    cursorCanvas.height = rect.height;
});

// --- Init ---
checkAuth();
renderHistory();
