// --- Auth + Credits ---
let userCredits = 0;

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/verify');
        const data = await res.json();
        if (!data.authenticated) { window.location.href = '/auth/'; return; }
        const user = data.user;
        document.getElementById('user-initials').textContent = (user.name?.[0] || user.email[0]).toUpperCase();
        document.getElementById('sidebar-user-name').textContent = user.name || user.email;
        userCredits = data.credits;
        updateCreditUI();
    } catch { window.location.href = '/auth/'; }
}

function calcCost(chars) {
    if (chars <= 0) return 100; // minimum 100
    return Math.ceil(chars / 1000) * 100;
}

function updateCreditUI() {
    document.getElementById('credit-balance').textContent = `${userCredits} credits`;
    updateCostLabel();
}

function updateCostLabel() {
    const text = document.getElementById('gen-text').value.trim();
    const cost = text.length > 0 ? calcCost(text.length) : 100;
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

// --- Status ---
function setStatus(type, msg) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    text.textContent = msg;
    dot.className = 'w-1.5 h-1.5 rounded-full';
    if (type === 'idle') { dot.classList.add('bg-lime', 'animate-pulse'); }
    else if (type === 'busy') { dot.classList.add('bg-tertiary', 'animate-pulse'); }
    else if (type === 'ready') { dot.classList.add('bg-lime'); }
    else if (type === 'error') { dot.classList.add('bg-error'); }
}

// --- Tab switching (File / Record / URL) ---
const tabs = { file: 'tab-file', record: 'tab-record', url: 'tab-url' };
const inputs = { file: 'input-file', record: 'input-record', url: 'input-url' };
const activeTabCls = 'bg-lime/20 text-lime border-lime/30';
const inactiveTabCls = 'hover:bg-surface-container-high text-on-surface-variant border-outline-variant/15';

function switchTab(tab) {
    for (const [key, id] of Object.entries(tabs)) {
        const el = document.getElementById(id);
        el.className = `flex-1 px-2 py-2 rounded-xl text-[10px] font-label font-medium flex items-center justify-center gap-1 transition-colors border ${key === tab ? activeTabCls : inactiveTabCls}`;
    }
    for (const [key, id] of Object.entries(inputs)) {
        document.getElementById(id).classList.toggle('hidden', key !== tab);
    }
}

document.getElementById('tab-file').addEventListener('click', () => switchTab('file'));
document.getElementById('tab-record').addEventListener('click', () => switchTab('record'));
document.getElementById('tab-url').addEventListener('click', () => switchTab('url'));

// --- Audio Upload (File) ---
let uploadedAudioUrl = null;
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewAudio = document.getElementById('preview-audio');
const processBtn = document.getElementById('process-btn');

dropZone.addEventListener('click', (e) => {
    if (!e.target.closest('#clear-audio') && !e.target.closest('#preview-play')) fileInput.click();
});
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleAudioFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files.length) handleAudioFile(fileInput.files[0]); });

document.getElementById('clear-audio').addEventListener('click', (e) => {
    e.stopPropagation();
    resetAudio();
});

function resetAudio() {
    uploadedAudioUrl = null;
    fileInput.value = '';
    previewAudio.src = '';
    document.getElementById('audio-preview').classList.add('hidden');
    document.getElementById('upload-prompt').classList.remove('hidden');
    checkReady();
    setStatus('idle', 'Upload reference audio to start');
}

async function handleAudioFile(file) {
    if (!file) return;
    if (!file.type.startsWith('audio/') && file.type !== 'video/webm') {
        setStatus('error', 'Please upload an audio file');
        return;
    }
    if (file.size > 20 * 1024 * 1024) { setStatus('error', 'File too large (max 20MB)'); return; }

    // Show preview
    const url = URL.createObjectURL(file);
    previewAudio.src = url;
    previewAudio.onloadedmetadata = () => {
        document.getElementById('audio-duration').textContent = formatTime(previewAudio.duration);
    };
    document.getElementById('audio-filename').textContent = file.name;
    document.getElementById('audio-preview').classList.remove('hidden');
    document.getElementById('upload-prompt').classList.add('hidden');

    // Upload to server
    setStatus('busy', 'Uploading audio...');
    try {
        const formData = new FormData();
        formData.append('audio', file);
        const res = await fetch('/api/voice-cloner/upload', { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Upload failed');
        }
        const data = await res.json();
        uploadedAudioUrl = data.audioUrl;
        checkReady();
        setStatus('ready', 'Reference audio uploaded');
    } catch (err) {
        setStatus('error', err.message);
        resetAudio();
    }
}

// Preview play
let previewPlaying = false;
document.getElementById('preview-play').addEventListener('click', (e) => {
    e.stopPropagation();
    if (previewPlaying) {
        previewAudio.pause();
        document.querySelector('#preview-play .material-symbols-outlined').textContent = 'play_arrow';
    } else {
        previewAudio.play();
        document.querySelector('#preview-play .material-symbols-outlined').textContent = 'pause';
    }
    previewPlaying = !previewPlaying;
});
previewAudio.addEventListener('ended', () => {
    previewPlaying = false;
    document.querySelector('#preview-play .material-symbols-outlined').textContent = 'play_arrow';
});

// --- Recorder ---
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = 0;
let recTimerInterval = null;
let recordedBlob = null;

document.getElementById('rec-start').addEventListener('click', startRecording);
document.getElementById('rec-stop').addEventListener('click', stopRecording);
document.getElementById('rec-clear').addEventListener('click', clearRecording);

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        recordedChunks = [];

        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            recordedBlob = new Blob(recordedChunks, { type: 'audio/webm' });
            onRecordingComplete();
        };

        mediaRecorder.start(100);
        recordingStartTime = Date.now();
        recTimerInterval = setInterval(updateRecTimer, 200);

        document.getElementById('rec-start').classList.add('hidden');
        document.getElementById('rec-stop').classList.remove('hidden');
        document.getElementById('rec-idle-icon').classList.add('hidden');
        document.getElementById('rec-waveform').classList.remove('hidden');
        document.getElementById('rec-result').classList.add('hidden');
    } catch (err) {
        setStatus('error', 'Microphone access denied');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    clearInterval(recTimerInterval);
    document.getElementById('rec-stop').classList.add('hidden');
    document.getElementById('rec-start').classList.remove('hidden');
    document.getElementById('rec-waveform').classList.add('hidden');
    document.getElementById('rec-idle-icon').classList.remove('hidden');
}

function updateRecTimer() {
    const elapsed = (Date.now() - recordingStartTime) / 1000;
    document.getElementById('rec-timer').textContent = formatTime(elapsed);
}

async function onRecordingComplete() {
    const duration = (Date.now() - recordingStartTime) / 1000;
    document.getElementById('rec-duration').textContent = formatTime(duration);
    document.getElementById('rec-result').classList.remove('hidden');

    // Upload recorded audio
    setStatus('busy', 'Uploading recording...');
    try {
        const formData = new FormData();
        formData.append('audio', recordedBlob, `recording-${Date.now()}.webm`);
        const res = await fetch('/api/voice-cloner/upload', { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Upload failed');
        }
        const data = await res.json();
        uploadedAudioUrl = data.audioUrl;
        checkReady();
        setStatus('ready', 'Recording uploaded');
    } catch (err) {
        setStatus('error', err.message);
    }
}

// Playback recorded audio
let recPlaying = false;
const recAudioEl = document.createElement('audio');
document.getElementById('rec-play').addEventListener('click', () => {
    if (!recordedBlob) return;
    if (recPlaying) {
        recAudioEl.pause();
        document.querySelector('#rec-play .material-symbols-outlined').textContent = 'play_arrow';
    } else {
        recAudioEl.src = URL.createObjectURL(recordedBlob);
        recAudioEl.play();
        document.querySelector('#rec-play .material-symbols-outlined').textContent = 'pause';
    }
    recPlaying = !recPlaying;
});
recAudioEl.addEventListener('ended', () => {
    recPlaying = false;
    document.querySelector('#rec-play .material-symbols-outlined').textContent = 'play_arrow';
});

function clearRecording() {
    recordedBlob = null;
    uploadedAudioUrl = null;
    document.getElementById('rec-result').classList.add('hidden');
    document.getElementById('rec-timer').textContent = '00:00';
    checkReady();
    setStatus('idle', 'Upload reference audio to start');
}

// --- URL Input ---
document.getElementById('url-submit').addEventListener('click', handleUrl);
document.getElementById('url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUrl();
});

async function handleUrl() {
    const url = document.getElementById('url-input').value.trim();
    if (!url) return;

    setStatus('busy', 'Fetching audio from URL...');
    try {
        const res = await fetch('/api/voice-cloner/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to load audio');
        }
        const data = await res.json();
        uploadedAudioUrl = data.audioUrl;
        checkReady();
        setStatus('ready', 'Audio loaded from URL');
    } catch (err) {
        setStatus('error', err.message);
    }
}

// --- Text input + char counter ---
const genTextEl = document.getElementById('gen-text');
const charCountEl = document.getElementById('char-count');

genTextEl.addEventListener('input', () => {
    const len = genTextEl.value.length;
    charCountEl.textContent = `${len.toLocaleString()} / 5,000`;
    if (len > 5000) {
        charCountEl.classList.add('text-error');
    } else {
        charCountEl.classList.remove('text-error');
    }
    updateCostLabel();
    checkReady();
});

// --- Readiness check ---
function checkReady() {
    const hasAudio = !!uploadedAudioUrl;
    const hasText = genTextEl.value.trim().length >= 1;
    processBtn.disabled = !(hasAudio && hasText);
}

// --- Processing ---
processBtn.addEventListener('click', async () => {
    if (!uploadedAudioUrl) return;
    const text = genTextEl.value.trim();
    if (!text || text.length > 5000) return;

    const cost = calcCost(text.length);
    if (userCredits < cost) {
        setStatus('error', `Not enough credits (need ${cost}, have ${userCredits})`);
        return;
    }

    processBtn.disabled = true;
    document.getElementById('loader').classList.remove('hidden');
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('result-view').classList.add('hidden');
    setStatus('busy', 'Cloning voice...');

    try {
        const body = {
            audioUrl: uploadedAudioUrl,
            genText: text
        };
        const refText = document.getElementById('ref-text').value.trim();
        if (refText) body.refText = refText;

        const res = await fetch('/api/voice-cloner/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Processing failed');

        if (data.credits !== undefined) { userCredits = data.credits; updateCreditUI(); }

        showResult(data.resultUrl, text.length, data.cost);
        addToHistory(data.resultUrl, text.length, data.cost);
        setStatus('ready', 'Done! Download your audio or try again');
    } catch (err) {
        setStatus('error', err.message);
        document.getElementById('empty-state').classList.remove('hidden');
    } finally {
        processBtn.disabled = false;
        document.getElementById('loader').classList.add('hidden');
        checkReady();
    }
});

// --- Result player ---
const resultAudio = document.getElementById('result-audio');
const resultPlayBtn = document.getElementById('result-play-btn');
const resultSeek = document.getElementById('result-seek');
let resultPlaying = false;

function showResult(audioUrl, charCount, cost) {
    document.getElementById('result-view').classList.remove('hidden');
    document.getElementById('empty-state').classList.add('hidden');

    resultAudio.src = audioUrl;
    document.getElementById('result-meta').textContent = `${charCount.toLocaleString()} characters · ${cost} credits`;

    resultAudio.onloadedmetadata = () => {
        document.getElementById('result-total-time').textContent = formatTime(resultAudio.duration);
    };

    document.getElementById('result-download').onclick = () => {
        const a = document.createElement('a');
        a.href = audioUrl;
        a.download = `voice-clone-${Date.now()}.wav`;
        a.click();
    };
}

resultPlayBtn.addEventListener('click', () => {
    if (resultPlaying) {
        resultAudio.pause();
        resultPlayBtn.querySelector('.material-symbols-outlined').textContent = 'play_arrow';
    } else {
        resultAudio.play();
        resultPlayBtn.querySelector('.material-symbols-outlined').textContent = 'pause';
    }
    resultPlaying = !resultPlaying;
});

resultAudio.addEventListener('ended', () => {
    resultPlaying = false;
    resultPlayBtn.querySelector('.material-symbols-outlined').textContent = 'play_arrow';
    resultSeek.value = 0;
    document.getElementById('result-current-time').textContent = '0:00';
});

resultAudio.addEventListener('timeupdate', () => {
    if (resultAudio.duration) {
        resultSeek.value = (resultAudio.currentTime / resultAudio.duration) * 100;
        document.getElementById('result-current-time').textContent = formatTime(resultAudio.currentTime);
    }
});

resultSeek.addEventListener('input', () => {
    if (resultAudio.duration) {
        resultAudio.currentTime = (resultSeek.value / 100) * resultAudio.duration;
    }
});

// --- History ---
async function loadHistory() {
    try {
        const res = await fetch('/api/tool-history/voicecloner');
        if (!res.ok) return;
        const items = await res.json();
        renderHistory(items);
    } catch { /* ignore */ }
}

function renderHistory(items) {
    const list = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');

    // Remove old items (keep empty state)
    list.querySelectorAll('.history-item').forEach(el => el.remove());

    if (!items.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    for (const item of items) {
        const el = document.createElement('div');
        el.className = 'history-item group rounded-xl bg-surface-container/60 border border-outline-variant/10 p-3 hover:bg-surface-container-high/60 transition-colors cursor-pointer';

        const chars = item.metadata?.charCount || 0;
        const cost = item.metadata?.cost || 0;
        const date = new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        el.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-lg bg-lime/10 flex items-center justify-center flex-shrink-0">
                    <span class="material-symbols-outlined text-lime text-lg">graphic_eq</span>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-[11px] font-label text-on-surface font-medium">${chars.toLocaleString()} chars · ${cost} credits</div>
                    <div class="text-[10px] font-label text-on-surface-variant/50">${date}</div>
                </div>
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="hist-play p-1 rounded-lg hover:bg-lime/10 text-on-surface-variant hover:text-lime transition-colors" title="Play">
                        <span class="material-symbols-outlined text-sm">play_arrow</span>
                    </button>
                    <button class="hist-download p-1 rounded-lg hover:bg-lime/10 text-on-surface-variant hover:text-lime transition-colors" title="Download">
                        <span class="material-symbols-outlined text-sm">download</span>
                    </button>
                    <button class="hist-delete p-1 rounded-lg hover:bg-error/10 text-on-surface-variant hover:text-error transition-colors" title="Delete">
                        <span class="material-symbols-outlined text-sm">delete</span>
                    </button>
                </div>
            </div>
        `;

        el.querySelector('.hist-play').addEventListener('click', (e) => {
            e.stopPropagation();
            showResult(item.resultUrl, chars, cost);
            resultAudio.play();
            resultPlaying = true;
            resultPlayBtn.querySelector('.material-symbols-outlined').textContent = 'pause';
        });

        el.querySelector('.hist-download').addEventListener('click', (e) => {
            e.stopPropagation();
            const a = document.createElement('a');
            a.href = item.resultUrl;
            a.download = `voice-clone-${Date.now()}.wav`;
            a.click();
        });

        el.querySelector('.hist-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const res = await fetch(`/api/tool-history/${item._id}`, { method: 'DELETE' });
                if (res.ok) el.remove();
                if (!list.querySelector('.history-item')) empty.classList.remove('hidden');
            } catch { /* ignore */ }
        });

        el.addEventListener('click', () => {
            showResult(item.resultUrl, chars, cost);
        });

        list.appendChild(el);
    }
}

function addToHistory(resultUrl, charCount, cost) {
    loadHistory(); // Reload from server
}

// --- Helpers ---
function formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- Init ---
checkAuth().then(() => {
    loadHistory();
});
