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

document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/auth/';
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
let viewMode = 'compare'; // 'compare' | 'result'

function showResult(originalSrc, resultUrl) {
    currentResultUrl = resultUrl;
    currentOriginalSrc = originalSrc;
    viewMode = 'compare';

    const resultView = document.getElementById('result-view');
    const resultImg = document.getElementById('result-img');
    const originalOverlay = document.getElementById('original-overlay');
    const toolbar = document.getElementById('toolbar');

    resultImg.src = resultUrl;
    originalOverlay.src = originalSrc;

    resultView.classList.remove('hidden');
    toolbar.classList.remove('hidden');
    document.getElementById('empty-state').classList.add('hidden');

    // Reset compare slider to 50%
    requestAnimationFrame(() => initCompareSlider());
    updateToolbarButtons();
}

// --- Before/After Compare Slider ---
function initCompareSlider() {
    const container = document.getElementById('compare-container');
    const overlay = document.getElementById('compare-overlay');
    const handle = document.getElementById('compare-handle');
    const originalOverlay = document.getElementById('original-overlay');

    const w = container.offsetWidth;
    originalOverlay.style.width = w + 'px';
    overlay.style.setProperty('--full-width', w + 'px');

    setSliderPosition(0.5);

    let dragging = false;
    const onMove = (e) => {
        if (!dragging) return;
        const rect = container.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        setSliderPosition(pct);
    };

    container.addEventListener('mousedown', (e) => { dragging = true; onMove(e); });
    container.addEventListener('touchstart', (e) => { dragging = true; onMove(e); }, { passive: true });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', () => dragging = false);
    window.addEventListener('touchend', () => dragging = false);

    function setSliderPosition(pct) {
        const px = w * pct;
        overlay.style.width = px + 'px';
        handle.style.left = px + 'px';
    }
}

// --- Toolbar ---
document.getElementById('btn-compare').addEventListener('click', () => {
    viewMode = 'compare';
    document.getElementById('compare-overlay').classList.remove('hidden');
    document.getElementById('compare-handle').classList.remove('hidden');
    updateToolbarButtons();
});

document.getElementById('btn-result-only').addEventListener('click', () => {
    viewMode = 'result';
    document.getElementById('compare-overlay').classList.add('hidden');
    document.getElementById('compare-handle').classList.add('hidden');
    updateToolbarButtons();
});

function updateToolbarButtons() {
    const compareBtn = document.getElementById('btn-compare');
    const resultBtn = document.getElementById('btn-result-only');

    if (viewMode === 'compare') {
        compareBtn.className = compareBtn.className.replace('hover:bg-lime/15 text-on-surface-variant hover:text-on-surface', '').replace('bg-lime/20 text-lime', '') + ' bg-lime/20 text-lime';
        resultBtn.className = resultBtn.className.replace('bg-lime/20 text-lime', '').replace('hover:bg-lime/15 text-on-surface-variant hover:text-on-surface', '') + ' hover:bg-lime/15 text-on-surface-variant hover:text-on-surface';
    } else {
        resultBtn.className = resultBtn.className.replace('hover:bg-lime/15 text-on-surface-variant hover:text-on-surface', '').replace('bg-lime/20 text-lime', '') + ' bg-lime/20 text-lime';
        compareBtn.className = compareBtn.className.replace('bg-lime/20 text-lime', '').replace('hover:bg-lime/15 text-on-surface-variant hover:text-on-surface', '') + ' hover:bg-lime/15 text-on-surface-variant hover:text-on-surface';
    }
}

document.getElementById('btn-download').addEventListener('click', () => {
    if (!currentResultUrl) return;
    const a = document.createElement('a');
    a.href = currentResultUrl;
    a.download = `xemy-nobg-${Date.now()}.png`;
    a.click();
});

// --- History (session only, stored in memory) ---
const history = [];

function addToHistory(originalSrc, resultUrl) {
    history.unshift({ originalSrc, resultUrl, timestamp: Date.now() });
    if (history.length > 20) history.pop();
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

// --- Init ---
checkAuth();
