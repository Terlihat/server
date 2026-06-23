// --- 1. PWA & UPDATE LOGIC ---
let newWorker;
const updateBtn = document.getElementById('update-btn');

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { 
        navigator.serviceWorker.register('./sw.js').then(reg => {
            reg.addEventListener('updatefound', () => {
                newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        if (updateBtn) updateBtn.style.display = 'block';
                        showToast("Versi baru tersedia! Klik Update.");
                    }
                });
            });
        }).catch(err => console.error('Service Worker Error:', err));
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            window.location.reload();
            refreshing = true;
        }
    });
}

if (updateBtn) {
    updateBtn.addEventListener('click', () => {
        if (newWorker) newWorker.postMessage({ action: 'skipWaiting' });
    });
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

// --- 2. THEME CONTROLLER ---
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

// --- 3. WAKE LOCK ---
let wakeLock = null;
async function requestWakeLock() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} }
function releaseWakeLock() { if (wakeLock !== null) { wakeLock.release().then(() => wakeLock = null); } }
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && document.getElementById('progress-container').style.display === 'block') { await requestWakeLock(); } });

// --- 4. PEERJS ---
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
peer.on('connection', (connection) => { conn = connection; conn.on('open', () => setupConnection()); });

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
    conn.on('close', () => { releaseWakeLock(); showToast("Teman keluar."); setTimeout(() => location.reload(), 2000); });
}

function switchPage(page) {
    const pages = ['file', 'chat', 'game'];
    pages.forEach(p => {
        const area = document.getElementById(p === 'file' ? 'transfer-area' : p + '-area');
        if (area) area.style.display = (p === page) ? 'block' : 'none';
        const navBtn = document.getElementById('nav-' + p);
        if (navBtn) {
            if (p === page) navBtn.classList.add('active');
            else navBtn.classList.remove('active');
        }
    });
    if (page === 'chat') {
        const box = document.getElementById('chat-box');
        if (box) box.scrollTop = box.scrollHeight;
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

// --- 5. INCOMING DATA ---
let receiveBuffer = []; let receivedSize = 0; let incomingFileInfo = null;
let rcvStartTime = 0; let rcvLastUpdate = 0; let rcvBytesSinceLastUpdate = 0;

function handleIncomingData(data) {
    if (data.type === 'text') { 
        addChatMessage('Teman', data.content, false); showToast("Pesan obrolan baru masuk!"); 
    }
    else if (data.type === 'cancel') {
        receiveBuffer = []; receivedSize = 0;
        document.getElementById('progress-container').style.display = 'none'; document.getElementById('stats-area').style.display = 'none';
        document.getElementById('file-list').style.display = 'none';
        addToLog(`Dibatalkan pengirim.`, false); showToast("Pengirim membatalkan."); releaseWakeLock();
    }
    // --- FITUR BARU: Menggambar daftar file yang masuk ---
    else if (data.type === 'queue_meta') {
        const fileListDisplay = document.getElementById('file-list');
        fileListDisplay.style.display = 'block';
        fileListDisplay.innerHTML = `<div style="font-size:0.85rem; font-weight:bold; margin-bottom:10px; color:var(--primary);"><i class="fa-solid fa-cloud-arrow-down"></i> Menerima ${data.files.length} File:</div>`;
        data.files.forEach(f => {
            const nameDiv = document.createElement('div'); nameDiv.className = 'file-name'; nameDiv.textContent = f.name;
            // Tampilan ikon file penerima berwarna hijau/berbeda sedikit
            fileListDisplay.innerHTML += `<div class="file-item"><div class="file-thumb" style="background:rgba(16, 185, 129, 0.1); color:var(--success)"><i class="fa-solid fa-file-arrow-down"></i></div><div class="file-info">${nameDiv.outerHTML}<div class="file-size">${formatBytes(f.size)}</div></div></div>`;
        });
        switchPage('file');
    }
    else if (data.type === 'queue_done') {
        // Menyembunyikan daftar file 2 detik setelah file terakhir selesai
        setTimeout(() => { document.getElementById('file-list').style.display = 'none'; }, 2000);
    }
    // -----------------------------------------------------
    else if (data.type === 'meta') {
        incomingFileInfo = data; receiveBuffer = []; receivedSize = 0; requestWakeLock();
        switchPage('file'); 
        document.getElementById('progress-container').style.display = 'block'; document.getElementById('stats-area').style.display = 'flex';
        
        // Paksa UI untuk langsung menampilkan status 0%
        updateStats(0, "Mulai mengunduh...", "--:--"); 
        
        rcvStartTime = performance.now(); rcvLastUpdate = rcvStartTime; rcvBytesSinceLastUpdate = 0;
    } 
    else if (data.type === 'chunk') {
        receiveBuffer.push(data.data); receivedSize += data.data.byteLength; rcvBytesSinceLastUpdate += data.data.byteLength;
        const now = performance.now(); const timeDiff = now - rcvLastUpdate;
        
        // Perbaikan: Update UI jika jeda > 250ms ATAU jika ini adalah cuplikan data terakhir (selesai)
        if (timeDiff >= 250 || receivedSize === incomingFileInfo.size) {
            const percent = Math.round((receivedSize / incomingFileInfo.size) * 100); 
            const speedBps = (rcvBytesSinceLastUpdate / (timeDiff / 1000 || 0.001)); // Mencegah pembagian 0
            const etaSeconds = speedBps > 0 ? Math.ceil((incomingFileInfo.size - receivedSize) / speedBps) : 0;
            updateStats(percent, formatBytes(speedBps) + '/s', formatTime(etaSeconds)); 
            rcvLastUpdate = now; rcvBytesSinceLastUpdate = 0;
        }
    } 
    else if (data.type === 'eof') {
        updateStats(100, "Menyimpan...", "0s"); const blob = new Blob(receiveBuffer, { type: incomingFileInfo.mime });
        downloadFile(blob, incomingFileInfo.name); receiveBuffer = []; receivedSize = 0; 
        addToLog(`Diterima: ${incomingFileInfo.name}`, true); releaseWakeLock();
        setTimeout(() => { document.getElementById('progress-container').style.display = 'none'; document.getElementById('stats-area').style.display = 'none'; }, 2000);
    }
    else if (data.type === 'game_init') {
        myScore = 0; peerScore = 0; myCombo = 0; peerCombo = 0;
        renderBoard(data.boardData); showToast("Teman memulai game Onet!");
    } 
    else if (data.type === 'game_action') {
        handlePeerAction(data.actionData);
    }
    else if (data.type === 'game_powerup') {
        handlePeerPowerUp(data.actionData);
    }
}

// --- 6. FILE TRANSFER ---
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
	
	const queueInfo = filesQueue.map(f => ({ name: f.name, size: f.size }));
    conn.send({ type: 'queue_meta', files: queueInfo });
	
    currentFileIndex = 0; requestWakeLock(); processNextFileInQueue();
});
cancelBtn.addEventListener('click', () => {
    isCancelled = true; conn.send({ type: 'cancel' }); addToLog(`Dibatalkan oleh Anda.`, false);
    showToast("Dibatalkan."); resetUIAfterSend(); releaseWakeLock();
});

function processNextFileInQueue() {
    if (isCancelled) return;
    if (currentFileIndex >= filesQueue.length) { 
        showToast("Selesai!"); 
        conn.send({ type: 'queue_done' }); // Memberitahu teman bahwa semua antrean selesai
        resetUIAfterSend(); 
        releaseWakeLock(); 
        return; 
    }
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

function updateStats(percent, speed, eta) { document.getElementById('progress-bar').style.width = percent + '%'; document.getElementById('progress-text').innerText = `${percent}%`; document.getElementById('speed-text').innerText = speed; document.getElementById('eta-text').innerText = eta; }
function resetUIAfterSend() { document.getElementById('progress-container').style.display = 'none'; document.getElementById('stats-area').style.display = 'none'; document.getElementById('progress-bar').style.width = '0%'; fileInput.value = ""; fileInput.disabled = false; fileListDisplay.style.display = 'none'; filesQueue = []; sendBtn.style.display = 'block'; sendBtn.disabled = true; cancelBtn.style.display = 'none'; sendBtn.innerHTML = `<i class="fa-solid fa-file-export"></i> Kirim Semua`; }
function addToLog(message, isSuccess = true) { const emptyLog = document.getElementById('empty-log'); if(emptyLog) emptyLog.remove(); const li = document.createElement('li'); li.innerHTML = `${isSuccess ? '<i class="fa-solid fa-check" style="color:var(--success)"></i>' : '<i class="fa-solid fa-xmark" style="color:var(--danger)"></i>'} <span style="flex-grow:1;">${message}</span>`; document.getElementById('transfer-log').prepend(li); }
function downloadFile(blob, filename) { const url = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.style.display = 'none'; a.href = url; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 1000); }
function copyInviteLink() { const inviteLink = window.location.origin + window.location.pathname + "?connect=" + myIdStr; navigator.clipboard.writeText(inviteLink).then(() => showToast("Link Disalin!")); }
function formatBytes(bytes) { if (bytes === 0) return '0 B'; const k = 1024, sizes = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]; }
function formatTime(seconds) { if (seconds === Infinity || isNaN(seconds)) return "--:--"; if (seconds < 60) return `${seconds}s`; const m = Math.floor(seconds / 60); const s = seconds % 60; return `${m}m ${s}s`; }
function showToast(msg) { const toast = document.getElementById('toast'); toast.innerText = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000); }

// --- 7. CHAT LOGIC ---
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

// --- 8. GAME ONET 2.0 (THE CORE + CHAOS UPDATE + COMBO + ROCKS) ---
let onetBoardData = [];
let selectedIndex = null;

const THEMES = {
    buah: ['🍎','🍌','🍇','🍉','🍓','🥑','🥕','🌽','🥥','🍍','🍋','🍒','\uD83E\uDD5D','🍅','🍆','🥔','🍔','🍕'],
    hewan: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐴','🐸','🐵','🐔','🐧','🦆'],
    tech: ['💻','📱','⌚','⌨️','🖱️','🖨️','📷','📺','📻','🔋','🔌','💡','🕹️','📡','💾','💿','💽','🎧']
};

let myScore = 0; let peerScore = 0;
let myCombo = 0; let myLastMatchTime = 0;
let peerCombo = 0; let peerLastMatchTime = 0;
let myPowerUps = { shuffle: 1, hint: 1, freeze: 1 };
let isFrozen = false;

const COLS = 6; const ROWS = 6;

function startNewGame() {
    if (!conn) { showToast("Belum terhubung dengan teman!"); return; }
    
    const themeKey = document.getElementById('theme-select').value;
    const currentIcons = THEMES[themeKey];
    
    const rockCount = 4;
    const pairCount = ((COLS * ROWS) - rockCount) / 2; 
    
    let selectedIcons = [];
    for(let i = 0; i < pairCount; i++) {
        selectedIcons.push(currentIcons[i % currentIcons.length]);
    }
    
    let deck = [...selectedIcons, ...selectedIcons];
    for(let i = 0; i < rockCount; i++) {
        deck.push('🪨'); 
    }
    
    deck.sort(() => Math.random() - 0.5);

    const newBoard = deck.map((icon, index) => ({ 
        id: index, 
        icon: icon, 
        isCleared: false,
        isRock: icon === '🪨'
    }));
    
    myPowerUps = { shuffle: 1, hint: 1, freeze: 1 };
    updatePowerUpUI();
    myScore = 0; peerScore = 0;
    myCombo = 0; peerCombo = 0;

    renderBoard(newBoard);
    conn.send({ type: 'game_init', boardData: newBoard });
}

function renderBoard(boardData) {
    onetBoardData = boardData;
    selectedIndex = null;
    updateScoreUI();
    
    const boardEl = document.getElementById('onet-board');
    if(boardEl) {
        boardEl.innerHTML = '';
        boardEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
        boardData.forEach((tile, index) => {
            const tileEl = document.createElement('div');
            tileEl.className = `onet-tile ${tile.isCleared ? 'hidden' : ''}`;
            if (tile.isRock) tileEl.classList.add('rock-tile');
            tileEl.innerText = tile.icon;
            tileEl.onclick = () => onTileClick(index);
            tileEl.id = `tile-${index}`;
            boardEl.appendChild(tileEl);
        });
    }
}

function updateScoreUI() {
    const scoreEl = document.getElementById('game-score');
    if(scoreEl) scoreEl.innerHTML = `<div class="score-container"><span class="score-me">Anda: ${myScore}</span> <span style="color:var(--text-color); opacity:0.5;">|</span> <span class="score-peer">Teman: ${peerScore}</span></div>`;
}

function updatePowerUpUI() {
    document.getElementById('btn-shuffle').innerHTML = `<i class="fa-solid fa-shuffle"></i> Acak (${myPowerUps.shuffle})`;
    document.getElementById('btn-hint').innerHTML = `<i class="fa-solid fa-lightbulb"></i> Petunjuk (${myPowerUps.hint})`;
    document.getElementById('btn-freeze').innerHTML = `<i class="fa-solid fa-snowflake"></i> Bekukan (${myPowerUps.freeze})`;
}

let comboTimeout;
function showComboText(player, combo, color) {
    const comboEl = document.getElementById('combo-text');
    if (!comboEl) return;
    clearTimeout(comboTimeout);
    
    if (combo > 1) {
        comboEl.innerHTML = `<span class="combo-anim" style="color: ${color};">${player} COMBO x${combo}! 🔥</span>`;
        if ('vibrate' in navigator) navigator.vibrate([50, 50]); 
    } else {
        comboEl.innerHTML = "";
    }
    
    comboTimeout = setTimeout(() => { comboEl.innerHTML = ""; }, 2000);
}

function onTileClick(index) {
    if (isFrozen) { showToast("Tubuh Anda membeku! Tidak bisa bergerak!"); return; }
    if (onetBoardData[index].isCleared || onetBoardData[index].isRock) return;
    conn.send({ type: 'game_action', actionData: { index: index } });
    processGameLogic(index, false); 
}

function handlePeerAction(actionData) {
    processGameLogic(actionData.index, true); 
}

function processGameLogic(index, isFromPeer) {
    const tilesEl = document.querySelectorAll('.onet-tile');
    
    if (selectedIndex === null) {
        selectedIndex = index;
        tilesEl[index].classList.add('selected');
        return;
    }

    if (selectedIndex === index) {
        tilesEl[index].classList.remove('selected');
        selectedIndex = null;
        return;
    }

    const idx1 = selectedIndex; const idx2 = index;
    const tile1 = onetBoardData[idx1]; const tile2 = onetBoardData[idx2];
    tilesEl[idx1].classList.remove('selected');
    selectedIndex = null; 

    // --- Pengecekan Lintasan Algoritma Segala Arah ---
    const pathPoints = checkOnetPath(idx1, idx2);

    if (tile1.icon === tile2.icon && pathPoints) {
        tile1.isCleared = true; tile2.isCleared = true;
        
        drawPath(pathPoints, isFromPeer);

        const matchClass = isFromPeer ? 'tile-match-peer' : 'tile-match-me';
        tilesEl[idx1].classList.add(matchClass); tilesEl[idx2].classList.add(matchClass);
        if ('vibrate' in navigator) navigator.vibrate(100);

        setTimeout(() => {
            tilesEl[idx1].classList.add('hidden');
            tilesEl[idx2].classList.add('hidden');
            applyGravity(); 
        }, 400); 
        
        const now = Date.now();
        let comboMulti = 1;
        
        if (isFromPeer) {
            if (now - peerLastMatchTime < 4000) peerCombo++; else peerCombo = 1;
            peerLastMatchTime = now;
            comboMulti = peerCombo;
            peerScore += (10 * comboMulti); 
            showComboText('Teman', comboMulti, 'var(--danger)');
        } else {
            if (now - myLastMatchTime < 4000) myCombo++; else myCombo = 1;
            myLastMatchTime = now;
            comboMulti = myCombo;
            myScore += (10 * comboMulti);
            showComboText('Anda', comboMulti, 'var(--primary)');
        }
        updateScoreUI();
    } else {
        if ('vibrate' in navigator) navigator.vibrate([50, 50, 50]);
        tilesEl[idx1].classList.add('error'); tilesEl[idx2].classList.add('error');
        setTimeout(() => { tilesEl[idx1].classList.remove('error'); tilesEl[idx2].classList.remove('error'); }, 300);
    }
}

function applyGravity() {
    let changed = false;
    for (let x = 0; x < COLS; x++) {
        let emptySpots = 0;
        for (let y = ROWS - 1; y >= 0; y--) {
            let idx = y * COLS + x;
            if (onetBoardData[idx].isCleared) {
                emptySpots++;
            } else if (emptySpots > 0) {
                let targetIdx = (y + emptySpots) * COLS + x;
                onetBoardData[targetIdx] = onetBoardData[idx];
                onetBoardData[idx] = { id: -1, icon: '', isCleared: true, isRock: false };
                changed = true;
            }
        }
    }
    if (changed) {
        setTimeout(() => { renderBoard(onetBoardData); }, 100); 
    }
}

function usePowerUp(type) {
    if (myPowerUps[type] <= 0 || isFrozen) return;
    myPowerUps[type]--;
    updatePowerUpUI();

    if (type === 'shuffle') {
        doShuffle();
        conn.send({ type: 'game_powerup', actionData: { action: 'shuffle', board: onetBoardData } });
    } else if (type === 'hint') {
        doHint(); 
    } else if (type === 'freeze') {
        conn.send({ type: 'game_powerup', actionData: { action: 'freeze' } });
        showToast("Mantra pembeku dikirim ke teman!");
    }
}

function doShuffle() {
    let remainingIcons = [];
    onetBoardData.forEach(t => { if (!t.isCleared && !t.isRock) remainingIcons.push(t.icon); });
    remainingIcons.sort(() => Math.random() - 0.5);
    let iconIdx = 0;
    onetBoardData.forEach(t => { if (!t.isCleared && !t.isRock) t.icon = remainingIcons[iconIdx++]; });
    renderBoard(onetBoardData);
    showToast("Papan diacak!");
}

function doHint() {
    for(let i=0; i<onetBoardData.length; i++) {
        if(onetBoardData[i].isCleared || onetBoardData[i].isRock) continue;
        for(let j=i+1; j<onetBoardData.length; j++) {
            if(!onetBoardData[j].isCleared && !onetBoardData[j].isRock && onetBoardData[i].icon === onetBoardData[j].icon) {
                if(checkOnetPath(i, j)) {
                    const t1 = document.getElementById(`tile-${i}`);
                    const t2 = document.getElementById(`tile-${j}`);
                    if(t1) t1.classList.add('hint-glow');
                    if(t2) t2.classList.add('hint-glow');
                    setTimeout(() => { if(t1) t1.classList.remove('hint-glow'); if(t2) t2.classList.remove('hint-glow'); }, 2000);
                    return;
                }
            }
        }
    }
    showToast("Oops, sepertinya tidak ada jalan yang terbuka!");
}

function handlePeerPowerUp(actionData) {
    if (actionData.action === 'shuffle') {
        onetBoardData = actionData.board;
        renderBoard(onetBoardData);
        showToast("Papan diacak oleh teman!");
    } else if (actionData.action === 'freeze') {
        isFrozen = true;
        showToast("LAYAR ANDA DIBEKUKAN TEMAN!");
        document.getElementById('onet-board').classList.add('frozen-board');
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
        setTimeout(() => {
            isFrozen = false;
            document.getElementById('onet-board').classList.remove('frozen-board');
            showToast("Bebas dari kebekuan! Balas dendam!");
        }, 3000); 
    }
}

// --- LOGIKA ONET PINTAR: GENERATOR MATRIX ---
function getGrid() {
    // Membuat grid dengan padding +2 agar garis bisa memutar lewat luar papan
    let grid = Array(ROWS + 2).fill(0).map(() => Array(COLS + 2).fill(0));
    for(let i=0; i<onetBoardData.length; i++) {
        if(!onetBoardData[i].isCleared || onetBoardData[i].isRock) {
            grid[Math.floor(i / COLS) + 1][(i % COLS) + 1] = 1; // 1 berarti rintangan (Batu / Ikon)
        }
    }
    return grid;
}

// --- LOGIKA ONET PINTAR: PENGECEKAN GARIS LURUS ---
function checkLine(x1, y1, x2, y2, grid) {
    if (x1 === x2) {
        for (let y = Math.min(y1, y2) + 1; y < Math.max(y1, y2); y++) if (grid[y][x1] !== 0) return false;
        return true;
    }
    if (y1 === y2) {
        for (let x = Math.min(x1, x2) + 1; x < Math.max(x1, x2); x++) if (grid[y1][x] !== 0) return false;
        return true;
    }
    return false;
}

// --- LOGIKA ONET PINTAR: PENCARIAN JALUR (0, 1, ATAU 2 BELOKAN) ---
function checkOnetPath(idx1, idx2) {
    let x1 = (idx1 % COLS) + 1, y1 = Math.floor(idx1 / COLS) + 1;
    let x2 = (idx2 % COLS) + 1, y2 = Math.floor(idx2 / COLS) + 1;
    let grid = getGrid();
    
    grid[y1][x1] = 0; grid[y2][x2] = 0; // Bebaskan posisi start dan end sementara

    // Jalur 0 Belokan (Lurus)
    if (x1 === x2 || y1 === y2) {
        if (checkLine(x1, y1, x2, y2, grid)) return [{x: x1, y: y1}, {x: x2, y: y2}];
    }
    
    // Jalur 1 Belokan (Bentuk L)
    if (grid[y1][x2] === 0 && checkLine(x1, y1, x2, y1, grid) && checkLine(x2, y1, x2, y2, grid)) {
        return [{x: x1, y: y1}, {x: x2, y: y1}, {x: x2, y: y2}];
    }
    if (grid[y2][x1] === 0 && checkLine(x1, y1, x1, y2, grid) && checkLine(x1, y2, x2, y2, grid)) {
        return [{x: x1, y: y1}, {x: x1, y: y2}, {x: x2, y: y2}];
    }
    
    // Jalur 2 Belokan (Bentuk U atau Z - Horizontal dan Luar Papan)
    for (let x = 0; x < COLS + 2; x++) {
        if (grid[y1][x] === 0 && checkLine(x1, y1, x, y1, grid)) {
            if (grid[y2][x] === 0 && checkLine(x, y1, x, y2, grid) && checkLine(x, y2, x2, y2, grid)) {
                return [{x: x1, y: y1}, {x: x, y: y1}, {x: x, y: y2}, {x: x2, y: y2}];
            }
        }
    }
    
    // Jalur 2 Belokan (Bentuk U atau Z - Vertikal dan Luar Papan)
    for (let y = 0; y < ROWS + 2; y++) {
        if (grid[y][x1] === 0 && checkLine(x1, y1, x1, y, grid)) {
            if (grid[y][x2] === 0 && checkLine(x1, y, x2, y, grid) && checkLine(x2, y, x2, y2, grid)) {
                return [{x: x1, y: y1}, {x: x1, y: y}, {x: x2, y: y}, {x: x2, y: y2}];
            }
        }
    }
    return null; 
}

function drawPath(points, isPeer) {
    const svg = document.getElementById('path-svg');
    const boardRect = document.getElementById('onet-board').getBoundingClientRect();
    if (!svg || !boardRect) return;

    const gap = 8; const padding = 10;
    const tileW = (boardRect.width - (padding * 2) - ((COLS - 1) * gap)) / COLS;
    const tileH = 50; 

    let polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    let pointsStr = "";
    
    points.forEach(p => {
        const cx = padding + (p.x - 1) * (tileW + gap) + (tileW / 2);
        const cy = padding + (p.y - 1) * (tileH + gap) + (tileH / 2);
        pointsStr += `${cx},${cy} `;
    });
    
    polyline.setAttribute('points', pointsStr.trim());
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', isPeer ? 'var(--danger)' : 'var(--primary)');
    polyline.setAttribute('stroke-width', '5');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    polyline.setAttribute('class', 'path-line');
    
    svg.appendChild(polyline);
    
    setTimeout(() => { svg.innerHTML = ''; }, 400);
}
