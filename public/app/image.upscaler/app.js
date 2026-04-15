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
    const cost = creditCosts.upscaler || 10;
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

// --- Scale selector ---
let selectedScale = 2;
const scaleBtns = document.querySelectorAll('.scale-btn');
scaleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        selectedScale = parseInt(btn.dataset.scale);
        scaleBtns.forEach(b => {
            b.classList.remove('bg-lime/20', 'text-lime', 'border-lime/30');
            b.classList.add('hover:bg-surface-container-high', 'text-on-surface-variant', 'border-outline-variant/15');
        });
        btn.classList.remove('hover:bg-surface-container-high', 'text-on-surface-variant', 'border-outline-variant/15');
        btn.classList.add('bg-lime/20', 'text-lime', 'border-lime/30');
    });
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

    const reader = new FileReader();
    reader.onload = (e) => {
        imagePreview.src = e.target.result;
        originalPreviewSrc = e.target.result;
        previewContainer.classList.remove('hidden');
        uploadPrompt.classList.add('hidden');
    };
    reader.readAsDataURL(file);

    setStatus('busy', 'Uploading...');
    try {
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch('/api/image-upscaler/upload', { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Upload failed');
        }
        const data = await res.json();
        uploadedImageUrl = data.imageUrl;
        processBtn.disabled = false;
        setStatus('ready', 'Ready — click Upscale Image');
    } catch (err) {
        setStatus('error', err.message);
    }
}

// --- Processing ---
processBtn.addEventListener('click', async () => {
    if (!uploadedImageUrl) return;

    const cost = creditCosts.upscaler || 10;
    if (userCredits < cost) {
        setStatus('error', `Not enough credits (need ${cost}, have ${userCredits})`);
        return;
    }

    processBtn.disabled = true;
    document.getElementById('loader').classList.remove('hidden');
    document.getElementById('empty-state').classList.add('hidden');
    setStatus('busy', 'Upscaling image...');

    try {
        const res = await fetch('/api/image-upscaler/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: uploadedImageUrl, scale: selectedScale })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Processing failed');

        if (data.credits !== undefined) { userCredits = data.credits; updateCreditUI(); }

        showResult(originalPreviewSrc, data.resultUrl, data.originalWidth, data.originalHeight, data.width, data.height);
        addToHistory(originalPreviewSrc, data.resultUrl, data);
        XemyCrossUse.showActions(data.resultUrl);
        setStatus('ready', 'Done! Download your upscaled image');
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
let viewMode = 'compare';

function showResult(originalSrc, resultUrl, origW, origH, newW, newH) {
    currentResultUrl = resultUrl;

    const resultView = document.getElementById('result-view');
    const resultImg = document.getElementById('result-img');
    const originalOverlay = document.getElementById('original-overlay');
    const toolbar = document.getElementById('toolbar');

    resultImg.src = resultUrl;
    originalOverlay.src = originalSrc;

    resultView.classList.remove('hidden');
    toolbar.classList.remove('hidden');
    document.getElementById('empty-state').classList.add('hidden');

    // Show dimension info
    if (origW && origH && newW && newH) {
        document.getElementById('original-dims').textContent = `${origW} × ${origH}`;
        document.getElementById('upscaled-dims').textContent = `${newW} × ${newH}`;
        document.getElementById('dimension-info').classList.remove('hidden');
    }

    initCompareSlider();
    setViewMode('compare');
}

// --- Compare Slider ---
let _sliderAbort = null;

function initCompareSlider() {
    if (_sliderAbort) _sliderAbort.abort();
    _sliderAbort = new AbortController();
    const signal = _sliderAbort.signal;

    const container = document.getElementById('compare-container');
    const overlay = document.getElementById('compare-overlay');
    const handle = document.getElementById('compare-handle');

    function setSliderPosition(pct) {
        const w = container.offsetWidth;
        if (w === 0) return;
        const clipRight = (1 - pct) * 100;
        overlay.style.clipPath = `inset(0 ${clipRight}% 0 0)`;
        handle.style.left = (w * pct) + 'px';
    }

    let dragging = false;
    function startDrag(e) {
        dragging = true;
        moveDrag(e);
    }
    function moveDrag(e) {
        if (!dragging) return;
        const rect = container.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        setSliderPosition(pct);
    }
    function stopDrag() { dragging = false; }

    container.addEventListener('mousedown', startDrag, { signal });
    window.addEventListener('mousemove', moveDrag, { signal });
    window.addEventListener('mouseup', stopDrag, { signal });
    container.addEventListener('touchstart', startDrag, { passive: true, signal });
    window.addEventListener('touchmove', moveDrag, { passive: true, signal });
    window.addEventListener('touchend', stopDrag, { signal });

    setSliderPosition(0.5);
}

// --- View Mode ---
function setViewMode(mode) {
    viewMode = mode;
    const container = document.getElementById('compare-container');
    const overlay = document.getElementById('compare-overlay');
    const handle = document.getElementById('compare-handle');

    document.querySelectorAll('.toolbar-btn').forEach(b => {
        b.classList.remove('bg-lime/20', 'text-lime', 'border-lime/30');
        b.classList.add('hover:bg-surface-container-high', 'text-on-surface-variant', 'border-outline-variant/15');
    });

    if (mode === 'compare') {
        document.getElementById('view-compare').classList.remove('hover:bg-surface-container-high', 'text-on-surface-variant', 'border-outline-variant/15');
        document.getElementById('view-compare').classList.add('bg-lime/20', 'text-lime', 'border-lime/30');
        overlay.classList.remove('hidden');
        handle.classList.remove('hidden');
        container.style.cursor = 'col-resize';
    } else {
        document.getElementById('view-result').classList.remove('hover:bg-surface-container-high', 'text-on-surface-variant', 'border-outline-variant/15');
        document.getElementById('view-result').classList.add('bg-lime/20', 'text-lime', 'border-lime/30');
        overlay.classList.add('hidden');
        handle.classList.add('hidden');
        container.style.cursor = 'default';
    }
}

document.getElementById('view-compare').addEventListener('click', () => setViewMode('compare'));
document.getElementById('view-result').addEventListener('click', () => setViewMode('result'));

// --- Download ---
document.getElementById('download-btn').addEventListener('click', async () => {
    if (!currentResultUrl) return;
    try {
        const res = await fetch(currentResultUrl);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `xemy-upscaled-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        setStatus('error', 'Download failed');
    }
});

// --- History (server-backed) ---
async function loadHistory() {
    try {
        const res = await fetch('/api/tool-history/upscaler');
        if (!res.ok) return;
        const items = await res.json();
        renderHistory(items);
    } catch {}
}

function renderHistory(items) {
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    if (!items.length) {
        list.innerHTML = '<p class="text-[10px] text-on-surface-variant/30 text-center pt-8 font-label">No upscales yet</p>';
        return;
    }
    for (const item of items) {
        const el = document.createElement('div');
        el.className = 'flex items-center gap-2 p-2 rounded-xl bg-surface-container/60 border border-outline-variant/10 cursor-pointer hover:bg-surface-container-high/80 transition-colors group';
        el.innerHTML = `
            <img src="${item.resultUrl}" class="w-12 h-12 rounded-lg object-cover border border-outline-variant/10" />
            <div class="flex-1 min-w-0">
                <p class="text-[10px] text-on-surface-variant font-label truncate">${item.metadata?.scale || 2}× Upscale</p>
                <p class="text-[9px] text-on-surface-variant/40 font-label">${new Date(item.createdAt).toLocaleTimeString()}</p>
            </div>
            <button class="delete-history opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/20 text-on-surface-variant/40 hover:text-error transition-all" title="Delete">
                <span class="material-symbols-outlined text-sm">close</span>
            </button>
        `;
        el.querySelector('.delete-history').addEventListener('click', async (e) => {
            e.stopPropagation();
            await fetch(`/api/tool-history/${item._id}`, { method: 'DELETE' });
            el.remove();
            if (!list.children.length) list.innerHTML = '<p class="text-[10px] text-on-surface-variant/30 text-center pt-8 font-label">No upscales yet</p>';
        });
        el.addEventListener('click', () => showResult(item.originalUrl, item.resultUrl, item.metadata?.originalWidth, item.metadata?.originalHeight, item.metadata?.width, item.metadata?.height));
        list.appendChild(el);
    }
}

function addToHistory(originalSrc, resultUrl, data) {
    // Prepend to DOM immediately, full reload on next page load
    const list = document.getElementById('history-list');
    if (list.querySelector('p')) list.innerHTML = '';

    const item = document.createElement('div');
    item.className = 'flex items-center gap-2 p-2 rounded-xl bg-surface-container/60 border border-outline-variant/10 cursor-pointer hover:bg-surface-container-high/80 transition-colors';
    item.innerHTML = `
        <img src="${resultUrl}" class="w-12 h-12 rounded-lg object-cover border border-outline-variant/10" />
        <div class="flex-1 min-w-0">
            <p class="text-[10px] text-on-surface-variant font-label truncate">${selectedScale}× Upscale</p>
            <p class="text-[9px] text-on-surface-variant/40 font-label">${new Date().toLocaleTimeString()}</p>
        </div>
    `;
    item.addEventListener('click', () => {
        showResult(originalSrc, resultUrl, data?.originalWidth, data?.originalHeight, data?.width, data?.height);
    });
    list.prepend(item);
}

// --- Status Bar ---
function setStatus(state, text) {
    const icon = document.getElementById('status-icon');
    const label = document.getElementById('status-text');
    label.textContent = text;

    icon.classList.remove('hidden', 'text-lime', 'text-error', 'animate-spin');
    switch (state) {
        case 'ready':
            icon.textContent = 'check_circle';
            icon.classList.add('text-lime');
            break;
        case 'error':
            icon.textContent = 'error';
            icon.classList.add('text-error');
            break;
        case 'busy':
            icon.textContent = 'progress_activity';
            icon.classList.add('text-on-surface-variant', 'animate-spin');
            break;
        default:
            icon.classList.add('hidden');
    }
}

// --- URL Input ---
async function handleUrl(url) {
    setStatus('busy', 'Loading image from URL...');
    try {
        const res = await fetch('/api/image-upscaler/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'URL upload failed');
        }
        const data = await res.json();
        uploadedImageUrl = data.imageUrl;
        // Show preview
        imagePreview.src = url;
        originalPreviewSrc = url;
        previewContainer.classList.remove('hidden');
        uploadPrompt.classList.add('hidden');
        processBtn.disabled = false;
        setStatus('ready', 'Ready — click Upscale Image');
    } catch (err) {
        setStatus('error', err.message);
    }
}

document.getElementById('url-submit').addEventListener('click', () => {
    const url = document.getElementById('url-input').value.trim();
    if (url) handleUrl(url);
});

document.getElementById('url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const url = e.target.value.trim();
        if (url) handleUrl(url);
    }
});

// --- Init ---
checkAuth().then(() => {
    loadHistory();
    const incoming = XemyCrossUse.receive();
    if (incoming) handleUrl(incoming.url);
});
