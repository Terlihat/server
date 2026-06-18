// --- 1. SERVICE WORKER & PWA REGISTRATION ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js'); });
}
let deferredPrompt;
const installBtn = document.getElementById('install-btn');
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e; installBtn.style.display = 'block';
});
installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') installBtn.style.display = 'none';
        deferredPrompt = null;
    }
});

// --- 2. DARK/LIGHT THEME CONTROLLER ---
const root = document.documentElement;
const themeBtn = document.getElementById('theme-toggle');
const savedTheme = localStorage.getItem('theme') || 'dark';
root.setAttribute('data-theme', savedTheme);
themeBtn.innerHTML = savedTheme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
themeBtn.addEventListener('click', () => {
    const newTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', newTheme); localStorage.setItem('theme', newTheme);
    themeBtn.innerHTML = newTheme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
});

// --- 3. WAKE LOCK API ---
let wakeLock = null;
async function requestWakeLock() { 
    try { 
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); 
    } catch (err) {} 
}
function releaseWakeLock() { 
    if (wakeLock !== null) { wakeLock.release().then(() => wakeLock = null); } 
}
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && document.getElementById('progress-container').style.display === 'block') {
        await requestWakeLock();
    }
});

// --- 4. PEERJS INITIALIZATION & NETWORKING ---
let peer = null; let conn = null; let myIdStr = ""; let qrGenerated = false;
const urlParams = new URLSearchParams(window.location.search);
const autoConnectId = urlParams.get('connect');
const randomId = Math.floor(1000 + Math.random() * 9000).toString();

peer = new Peer(randomId, { debug: 1 });
peer.on('open', (id) => {
    myIdStr = id; document.getElementById('my-id').innerText = id;
    if(autoConnectId && autoConnectId !== id) { showToast("Menghubungkan..."); connectToPeer(autoConnectId); }
});
peer.on('error', (err) => {
    document.getElementById('my-id').innerHTML = '<span style="color:var(--danger); font-size:1.2rem;">Gagal Konek Server</span>';
    document.getElementById('status-wait').innerHTML = '<p style="color:var(--danger)">Server sibuk. Muat ulang.</p>'; showToast("Error: " + err.type);
});
peer.on('connection', (connection) => { 
    conn = connection; 
    conn.on('open', () => setupConnection()); 
});

function connectToPeer(targetId) {
    conn = peer.connect(targetId);
    conn.on('open', () => setupConnection()); conn.on('error', () => showToast("Gagal terhubung!"));
}

function connectManually() {
    const inputField = document.getElementById('peer-id-input');
    const targetId = inputField.value.trim();
    if (!targetId) { showToast("Masukkan ID terlebih dahulu!"); return; }
    if (targetId === myIdStr) { showToast("Tidak bisa konek ke ID sendiri!"); return; }
    showToast("Menghubungkan ke " + targetId + "...");
    connectToPeer(targetId);
}

function setupConnection() {
    document.getElementById('connection-area').style.display = 'none';
    document.getElementById('transfer-area').style.display = 'block';
    document.getElementById('bottom-bar').style.display = 'flex';
    showToast("Berhasil Terhubung!"); window.history.replaceState({}, document.title, window.location.pathname);
    conn.on('data', handleIncomingData);
    conn.on('close', () => {
        releaseWakeLock(); 
        showToast("Teman keluar."); setTimeout(() => location.reload(), 2000);
    });
}

// --- 5. SINGLE PAGE APPLICATION (SPA) PAGES SWITCHER ---
function switchPage(page) {
    const fileArea = document.getElementById('transfer-area');
    const chatArea = document.getElementById('chat-area');
    const navFile = document.getElementById('nav-file');
    const navChat = document.getElementById('nav-chat');

    if (page === 'file') {
        fileArea.style.display = 'block';
        chatArea.style.display = 'none';
        navFile.classList.add('active');
        navChat.classList.remove('active');
    } else if (page === 'chat') {
        fileArea.style.display = 'none';
        chatArea.style.display = 'block';
        navChat.classList.add('active');
        navFile.classList.remove('active');
        const box = document.getElementById('chat-box');
        box.scrollTop = box.scrollHeight;
    }
}

function toggleQR() {
    const qrBox = document.getElementById('qr-box');
    if (qrBox.style.display === 'block') { qrBox.style.display = 'none'; } 
    else {
        qrBox.style.display = 'block';
        if (!qrGenerated) {
            const inviteLink = window.location.origin + window.location.pathname + "?connect=" + myIdStr;
            new QRCode(document.getElementById("qrcode"), { text: inviteLink, width: 150, height: 150, colorDark: "#1f2937", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H });
            qrGenerated = true;
        }
    }
}

// --- 6. INCOMING DATA HANDLER (FILE & TEXT CHAT) ---
let receiveBuffer = []; let receivedSize = 0; let incomingFileInfo = null;
let rcvStartTime = 0; let rcvLastUpdate = 0; let rcvBytesSinceLastUpdate = 0;

function handleIncomingData(data) {
    if (data.type === 'text') { 
        addChatMessage('Teman', data.content, false); 
        showToast("Pesan obrolan baru masuk!"); 
    }
    else if (data.type === 'cancel') {
        receiveBuffer = []; receivedSize = 0;
        document.getElementById('progress-container').style.display = 'none'; document.getElementById('stats-area').style.display = 'none';
        addToLog(`Dibatalkan pengirim.`, false); showToast("Pengirim membatalkan."); releaseWakeLock();
    }
    else if (data.type === 'meta') {
        incomingFileInfo = data; receiveBuffer = []; receivedSize = 0; requestWakeLock();
        switchPage('file'); 
        document.getElementById('progress-container').style.display = 'block'; document.getElementById('stats-area').style.display = 'flex';
        rcvStartTime = performance.now(); rcvLastUpdate = rcvStartTime; rcvBytesSinceLastUpdate = 0;
    } 
    else if (data.type === 'chunk') {
        receiveBuffer.push(data.data); receivedSize += data.data.byteLength; rcvBytesSinceLastUpdate += data.data.byteLength;
        const now = performance.now(); const timeDiff = now - rcvLastUpdate;
        if (timeDiff >= 250) {
            const percent = Math.round((receivedSize / incomingFileInfo.size) * 100); const speedBps = (rcvBytesSinceLastUpdate / (timeDiff / 1000));
            const etaSeconds = speedBps > 0 ? Math.ceil((incomingFileInfo.size - receivedSize) / speedBps) : 0;
            updateStats(percent, formatBytes(speedBps) + '/s', formatTime(etaSeconds)); rcvLastUpdate = now; rcvBytesSinceLastUpdate = 0;
        }
    } 
    else if (data.type === 'eof') {
        updateStats(100, "Menyimpan...", "0s"); const blob = new Blob(receiveBuffer, { type: incomingFileInfo.mime });
        downloadFile(blob, incomingFileInfo.name); receiveBuffer = []; receivedSize = 0; 
        addToLog(`Diterima: ${incomingFileInfo.name}`, true); releaseWakeLock();
        setTimeout(() => { document.getElementById('progress-container').style.display = 'none'; document.getElementById('stats-area').style.display = 'none'; }, 2000);
    }
}

// --- 7. OUTGOING FILE TRANSMISSION ---
let filesQueue = []; let currentFileIndex = 0; let isCancelled = false; let activeObjectUrls = [];
const fileInput = document.getElementById('file-input'); const fileListDisplay = document.getElementById('file-list');
const sendBtn = document.getElementById('send-btn'); const cancelBtn = document.getElementById('cancel-btn');
const dropZone = document.getElementById('drop-zone'); const dropUI = document.getElementById('drop-ui');

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, (ev) => {ev.preventDefault(); ev.stopPropagation();}, false));
['dragenter', 'dragover'].forEach(e => dropZone.addEventListener(e, () => dropUI.classList.add('dragover'), false));
['dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, () => dropUI.classList.remove('dragover'), false));
dropZone.addEventListener('drop', (e) => { if(!(sendBtn.disabled && filesQueue.length > 0)) handleFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

function handleFiles(files) {
    activeObjectUrls.forEach(url => URL.revokeObjectURL(url)); activeObjectUrls = [];
    const rawFiles = Array.from(files); filesQueue = [];
    const MAX_SIZE = 2 * 1024 * 1024 * 1024; let rejectedCount = 0;
    rawFiles.forEach(f => { if (f.size > MAX_SIZE) { rejectedCount++; } else { filesQueue.push(f); } });
    if (rejectedCount > 0) alert(`⚠️ ${rejectedCount} file diabaikan (> 2 GB).`);

    if (filesQueue.length > 0) {
        fileListDisplay.style.display = 'block'; fileListDisplay.innerHTML = "";
        filesQueue.forEach(f => {
            let thumbHtml = `<div class="file-thumb"><i class="fa-solid fa-file"></i></div>`;
            if (f.type.startsWith('image/')) {
                const imgUrl = URL.createObjectURL(f); activeObjectUrls.push(imgUrl);
                thumbHtml = `<img src="${imgUrl}" class="file-thumb">`;
            }
            const nameDiv = document.createElement('div'); nameDiv.className = 'file-name'; nameDiv.textContent = f.name;
            fileListDisplay.innerHTML += `<div class="file-item">${thumbHtml}<div class="file-info">${nameDiv.outerHTML}<div class="file-size">${formatBytes(f.size)}</div></div></div>`;
        });
        sendBtn.disabled = false; sendBtn.innerHTML = `<i class="fa-solid fa-file-export"></i> Kirim ${filesQueue.length} File`;
    } else { fileListDisplay.style.display = 'none'; sendBtn.disabled = true; }
}

sendBtn.addEventListener('click', () => {
    if (filesQueue.length === 0) return;
    isCancelled = false; sendBtn.style.display = 'none'; cancelBtn.style.display = 'block'; fileInput.disabled = true;
    currentFileIndex = 0; requestWakeLock(); processNextFileInQueue();
});
cancelBtn.addEventListener('click', () => {
    isCancelled = true; conn.send({ type: 'cancel' }); addToLog(`Dibatalkan oleh Anda.`, false);
    showToast("Dibatalkan."); resetUIAfterSend(); releaseWakeLock();
});

function processNextFileInQueue() {
    if (isCancelled) return;
    if (currentFileIndex >= filesQueue.length) { showToast("Selesai!"); resetUIAfterSend(); releaseWakeLock(); return; }
    sendFile(filesQueue[currentFileIndex]);
}

function sendFile(file) {
    if (file.size === 0) { addToLog(`File kosong dilewati`, false); currentFileIndex++; setTimeout(processNextFileInQueue, 100); return; }
    document.getElementById('progress-container').style.display = 'block'; document.getElementById('stats-area').style.display = 'flex';
    const CHUNK_SIZE = 1024 * 1024; let offset = 0;
    conn.send({ type: 'meta', name: file.name, size: file.size, mime: file.type });
    let startTime = performance.now(); let lastUpdate = startTime; let bytesSinceLastUpdate = 0;

    function readAndSendNextChunk() {
        if (isCancelled) return;
        if (conn.dataChannel.bufferedAmount > 1048576) { setTimeout(readAndSendNextChunk, 10); return; }
        const slice = file.slice(offset, offset + CHUNK_SIZE); const reader = new FileReader();
        reader.onload = (e) => {
            if (isCancelled) return;
            const chunkData = e.target.result; conn.send({ type: 'chunk', data: chunkData });
            offset += chunkData.byteLength; bytesSinceLastUpdate += chunkData.byteLength;
            const now = performance.now(); const timeDiff = now - lastUpdate;
            if (timeDiff >= 250 || offset >= file.size) {
                const percent = Math.round((offset / file.size) * 100); const speedBps = (bytesSinceLastUpdate / (timeDiff / 1000));
                const etaSeconds = speedBps > 0 ? Math.ceil((file.size - offset) / speedBps) : 0;
                updateStats(percent, formatBytes(speedBps) + '/s', formatTime(etaSeconds));
                lastUpdate = now; bytesSinceLastUpdate = 0;
            }
            if (offset < file.size) { setTimeout(readAndSendNextChunk, 0); } 
            else { conn.send({ type: 'eof' }); addToLog(`Terkirim: ${file.name}`, true); currentFileIndex++; setTimeout(processNextFileInQueue, 500); }
        };
        reader.readAsArrayBuffer(slice);
    }
    readAndSendNextChunk();
}

// --- 8. HELPER & UTILITY FUNCTIONS ---
function updateStats(percent, speed, eta) { document.getElementById('progress-bar').style.width = percent + '%'; document.getElementById('progress-text').innerText = `${percent}%`; document.getElementById('speed-text').innerText = speed; document.getElementById('eta-text').innerText = eta; }
function resetUIAfterSend() { document.getElementById('progress-container').style.display = 'none'; document.getElementById('stats-area').style.display = 'none'; document.getElementById('progress-bar').style.width = '0%'; fileInput.value = ""; fileInput.disabled = false; fileListDisplay.style.display = 'none'; filesQueue = []; sendBtn.style.display = 'block'; sendBtn.disabled = true; cancelBtn.style.display = 'none'; sendBtn.innerHTML = `<i class="fa-solid fa-file-export"></i> Kirim Semua`; }
function addToLog(message, isSuccess = true) { const emptyLog = document.getElementById('empty-log'); if(emptyLog) emptyLog.remove(); const li = document.createElement('li'); li.innerHTML = `${isSuccess ? '<i class="fa-solid fa-check" style="color:var(--success)"></i>' : '<i class="fa-solid fa-xmark" style="color:var(--danger)"></i>'} <span style="flex-grow:1;">${message}</span>`; document.getElementById('transfer-log').prepend(li); }
function downloadFile(blob, filename) { const url = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.style.display = 'none'; a.href = url; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 1000); }
function copyInviteLink() { const inviteLink = window.location.origin + window.location.pathname + "?connect=" + myIdStr; navigator.clipboard.writeText(inviteLink).then(() => showToast("Link Disalin!")); }
function formatBytes(bytes) { if (bytes === 0) return '0 B'; const k = 1024, sizes = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]; }
function formatTime(seconds) { if (seconds === Infinity || isNaN(seconds)) return "--:--"; if (seconds < 60) return `${seconds}s`; const m = Math.floor(seconds / 60); const s = seconds % 60; return `${m}m ${s}s`; }
function showToast(msg) { const toast = document.getElementById('toast'); toast.innerText = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000); }

// --- 9. CHAT SYSTEM LOGIC ---
function addChatMessage(sender, text, isMe){
    const chatBox = document.getElementById('chat-box');
    if (!chatBox) return;
    const msgDiv = document.createElement('div');
    msgDiv.style.background = isMe ? '#3b82f6':'#374151';
    msgDiv.style.color = '#fff';
    msgDiv.style.padding = '10px 14px';
    msgDiv.style.borderRadius = '14px';
    msgDiv.style.maxWidth = '80%';
    msgDiv.style.alignSelf = isMe ? 'flex-end':'flex-start';
    msgDiv.style.wordBreak = 'break-word';
    msgDiv.style.textAlign = 'left';
    msgDiv.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
    msgDiv.innerHTML = `<strong style="font-size:0.8em;opacity:0.8;display:block;margin-bottom:2px;">${sender}</strong> ${text}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

window.addEventListener('beforeunload', () =>{
    if (conn && conn.open){conn.send({type:'cancel'});conn.close();}
    if (peer && !peer.destroyed){peer.destroy();}
});

document.getElementById('btn-send-chat').addEventListener('click', () => {
    const chatInput = document.getElementById('chat-input');
    const text = chatInput.value.trim();
    if (!conn){ showToast("Belum terhubung!"); return; }
    if (text !== ""){
        conn.send({type:'text', content:text});
        addChatMessage('Anda', text, true);
        chatInput.value = "";
    }
});

document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter'){ document.getElementById('btn-send-chat').click(); }
});