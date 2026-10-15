// ==============================================================================
// CHẾ ĐỘ THI ĐẤU ĐỐI KHÁNG TRỰC TIẾP (1vs1 REALTIME BATTLE ARENA)
// 1. Tạo Phòng Chờ (Lobby) bằng Mã PIN 4 số & QR Code
// 2. Thanh tiến độ "Đua Ngựa" trực tiếp (Live Horse-Race Progress Bar)
// 3. Vật phẩm tương tác vui nhộn (Power-ups: Đóng băng 3s, Sương mù lau màn hình, Đảo phương án, Khiên chắn)
// 4. Hỗ trợ đa nền tảng: Firebase Firestore Realtime + BroadcastChannel + Bot AI Thông Minh
// ==============================================================================

// Biến trạng thái Đấu trường
let battleRoomPin = null;
let battlePlayerRole = 'host'; // 'host' | 'guest'
let battleRoomData = null;
let battleUnsubscribe = null;
let battleQuestions = [];
let battleCurrentQIndex = 0;
let battleScore = 0;
let battleStreak = 0;
let battleMaxStreak = 0;
let battlePowerUp = null; // Kỹ năng đang sở hữu: 'freeze' | 'fog' | 'scramble' | 'shield'
let battleHasShield = false;
let battleIsAiMode = false;
let battleAiInterval = null;
let battleChannel = null;
let battleTimerInterval = null;
let battleQuestionStartTime = 0;
let battleIsFrozen = false;
let battleDebuffTimeout = null;
let battleProcessedAttackIds = new Set();
let battleFogCanvas = null;
let battleFogCtx = null;
let battleFogPixelsCleared = 0;

// ==============================================================================
// HỆ THỐNG ÂM THANH ESPORTS (WEB AUDIO SYNTHESIZER - 0ms LATENCY)
// ==============================================================================
const BattleAudio = {
    ctx: null,
    init() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) this.ctx = new AudioCtx();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    },
    playTone(freq, type = 'sine', duration = 0.15, gainVal = 0.2) {
        try {
            this.init();
            if (!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) { }
    },
    countdown(num) {
        if (num > 0) this.playTone(440, 'triangle', 0.15, 0.25);
        else this.playTone(880, 'square', 0.4, 0.3); // GO!
    },
    correct() {
        // Hợp âm chiến thắng vui vẻ (C5 - E5 - G5)
        setTimeout(() => this.playTone(523.25, 'triangle', 0.1, 0.2), 0);
        setTimeout(() => this.playTone(659.25, 'triangle', 0.1, 0.2), 80);
        setTimeout(() => this.playTone(783.99, 'triangle', 0.25, 0.25), 160);
    },
    wrong() {
        // Âm thanh báo sai nhẹ
        this.playTone(180, 'sawtooth', 0.25, 0.15);
    },
    powerUpReady() {
        // Âm thanh nhận vật phẩm lấp lánh
        [523, 659, 784, 1046].forEach((f, i) => {
            setTimeout(() => this.playTone(f, 'sine', 0.15, 0.15), i * 60);
        });
    },
    attack() {
        // Âm thanh phóng kỹ năng
        this.playTone(600, 'sawtooth', 0.1, 0.2);
        setTimeout(() => this.playTone(300, 'sine', 0.2, 0.2), 80);
    },
    freeze() {
        // Âm thanh đóng băng lạnh giá
        this.playTone(900, 'sine', 0.1, 0.2);
        setTimeout(() => this.playTone(1200, 'triangle', 0.3, 0.15), 50);
    },
    fog() {
        // Tiếng gió rít / sương mù
        this.playTone(150, 'sawtooth', 0.4, 0.2);
    },
    shield() {
        // Tiếng khiên chặn đòn
        this.playTone(350, 'triangle', 0.1, 0.3);
        setTimeout(() => this.playTone(700, 'sine', 0.25, 0.25), 60);
    },
    victory() {
        // Khúc ca chiến thắng rực rỡ
        const notes = [523, 659, 784, 1046, 784, 1046];
        notes.forEach((f, i) => {
            setTimeout(() => this.playTone(f, 'triangle', 0.2, 0.3), i * 120);
        });
    },
    defeat() {
        [400, 350, 300, 250].forEach((f, i) => {
            setTimeout(() => this.playTone(f, 'sawtooth', 0.2, 0.15), i * 150);
        });
    }
};

// ==============================================================================
// KHỞI TẠO BỘ ĐIỀU HƯỚNG & LOBBY THI ĐẤU
// ==============================================================================

function initBattleLobbyUI() {
    renderBattleSubjectSelect();
    const pinInput = document.getElementById('battle-join-pin');
    if (pinInput) pinInput.value = '';
}

function renderBattleSubjectSelect() {
    const sel = document.getElementById('battle-create-subject');
    if (!sel) return;
    const subjects = ['Toán', 'Vật Lí', 'Hóa Học', 'Sinh Học', 'Tiếng Anh', 'Lịch Sử', 'Địa Lí', 'Tin Học', 'GDQP&AN', 'GDKT&PL', 'Công Nghệ'];
    sel.innerHTML = subjects.map(s => `<option value="${s}" ${s === selectedExamSubject ? 'selected' : ''}>${s}</option>`).join('');
}

function getBattlePlayerIdentity() {
    const user = (typeof currentAuthUser !== 'undefined' && currentAuthUser) || (typeof currentUser !== 'undefined' && currentUser);
    if (user && user.name) {
        return {
            id: user.username || user.id || 'usr_' + Date.now().toString(36),
            name: user.name,
            avatar: user.avatar || (user.role === 'admin' ? '👑' : '🎓')
        };
    }
    // Khách vãng lai: tạo danh tính vui nhộn
    let guestId = localStorage.getItem('battle_guest_id');
    let guestName = localStorage.getItem('battle_guest_name');
    let guestAvatar = localStorage.getItem('battle_guest_avatar');
    if (!guestId) {
        guestId = 'guest_' + Math.floor(1000 + Math.random() * 9000);
        const animals = ['Cáo Nhanh Trí', 'Hổ Quyết Thắng', 'Gấu Siêu Trí', 'Chim Ưng Tốc Độ', 'Cá Heo Thông Minh'];
        const emojis = ['🦊', '🐯', '🐼', '🦅', '🐬', '🦁', '🚀', '⚡'];
        guestName = animals[Math.floor(Math.random() * animals.length)] + ' #' + guestId.split('_')[1];
        guestAvatar = emojis[Math.floor(Math.random() * emojis.length)];
        localStorage.setItem('battle_guest_id', guestId);
        localStorage.setItem('battle_guest_name', guestName);
        localStorage.setItem('battle_guest_avatar', guestAvatar);
    }
    return { id: guestId, name: guestName, avatar: guestAvatar };
}

// Sinh mã PIN 4 số ngẫu nhiên (VD: 8899)
function generateBattlePin() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// ==============================================================================
// 1. TẠO PHÒNG CHỜ (LOBBY) & MÃ PIN / QR CODE
// ==============================================================================

async function createBattleRoom(isAi = false) {
    BattleAudio.init();
    battlePlayerRole = 'host';
    battleIsAiMode = isAi;
    battleRoomPin = generateBattlePin();
    battleScore = 0;
    battleStreak = 0;
    battleMaxStreak = 0;
    battlePowerUp = null;
    battleHasShield = false;
    battleCurrentQIndex = 0;
    battleProcessedAttackIds.clear();

    const subj = document.getElementById('battle-create-subject')?.value || selectedExamSubject || 'Toán';
    const grade = document.getElementById('battle-create-grade')?.value || selectedExamGrade || '12';

    // Tạm thời chọn môn & khối để lấy câu hỏi chuẩn
    const prevSubj = selectedExamSubject;
    const prevGrade = selectedExamGrade;
    selectedExamSubject = subj;
    selectedExamGrade = grade;
    selectedExamTopic = 'all';
    selectedExamPeriod = 'all';

    // Lấy 10 câu hỏi chuẩn từ ngân hàng đề thi
    let pool = (typeof getFilteredExamPool === 'function') ? getFilteredExamPool(10) : [];
    if (!pool || pool.length === 0) {
        if (typeof BUILTIN_EXAM_BANK !== 'undefined') {
            pool = (BUILTIN_EXAM_BANK[grade] && BUILTIN_EXAM_BANK[grade][subj]) || [];
        }
    }
    // Khôi phục lại trạng thái cũ
    selectedExamSubject = prevSubj;
    selectedExamGrade = prevGrade;

    // Lọc và xáo trộn 10 câu
    const cleanPool = (typeof filterDuplicateQuestionsByText === 'function') ? filterDuplicateQuestionsByText(pool) : pool;
    const shuffled = [...cleanPool].sort(() => Math.random() - 0.5);
    battleQuestions = shuffled.slice(0, 10).map((q, idx) => ({
        id: q.id || `bq_${idx + 1}`,
        num: idx + 1,
        content: q.content,
        options: [...q.options],
        correct: (q.correct || 'A').toUpperCase().trim(),
        explanation: q.explanation || 'Đang cập nhật lời giải.'
    }));

    if (battleQuestions.length < 5) {
        // Fallback tối thiểu để luôn thi đấu được
        for (let i = battleQuestions.length; i < 10; i++) {
            battleQuestions.push({
                id: `bq_fallback_${i + 1}`,
                num: i + 1,
                content: `Câu hỏi số ${i + 1} môn ${subj} lớp ${grade}: Đâu là phương án chính xác nhất?`,
                options: ['A. Đáp án chuẩn xác A', 'B. Phương án đối chiếu B', 'C. Dữ kiện thảo luận C', 'D. Kết quả khảo sát D'],
                correct: 'A',
                explanation: 'Kiến thức cốt lõi chương trình GDPT.'
            });
        }
    }

    const hostUser = getBattlePlayerIdentity();
    const guestUser = isAi ? {
        id: 'bot_ai_genius',
        name: 'Bot AI Trí Tuệ 🤖',
        avatar: '🤖',
        score: 0,
        progress: 0,
        currentQIndex: 0,
        streak: 0,
        finished: false
    } : null;

    battleRoomData = {
        pin: battleRoomPin,
        status: isAi ? 'ready' : 'waiting',
        createdAt: Date.now(),
        config: {
            subject: subj,
            grade: grade,
            topic: 'Tổng hợp kiến thức',
            questionCount: 10
        },
        host: {
            ...hostUser,
            score: 0,
            progress: 0,
            currentQIndex: 0,
            streak: 0,
            finished: false
        },
        guest: guestUser,
        questions: battleQuestions,
        attacks: []
    };

    // Mở kênh BroadcastChannel nội bộ để 2 tab trên cùng máy tính kết nối siêu tốc
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            if (battleChannel) battleChannel.close();
            battleChannel = new BroadcastChannel('steam_battle_room_' + battleRoomPin);
            battleChannel.onmessage = (ev) => {
                if (ev.data && ev.data.type === 'ROOM_UPDATE') {
                    handleRoomSnapshot(ev.data.data);
                }
            };
        }
    } catch (e) { console.warn("BroadcastChannel error:", e); }

    // Hiển thị giao diện Phòng chờ ngay lập tức
    renderWaitingRoomUI();

    // Đồng bộ lên Firebase Firestore nếu có kết nối
    if (typeof firestoreDb !== 'undefined' && firestoreDb) {
        try {
            firestoreDb.collection('battle_rooms').doc(`room_${battleRoomPin}`).set(battleRoomData).catch(e => {
                console.warn("Lưu Firestore battle_room lỗi (dùng local bus):", e);
            });
            // Lắng nghe thay đổi phòng theo thời gian thực (Realtime Listener)
            if (battleUnsubscribe) battleUnsubscribe();
            battleUnsubscribe = firestoreDb.collection('battle_rooms').doc(`room_${battleRoomPin}`)
                .onSnapshot((doc) => {
                    if (doc.exists) {
                        handleRoomSnapshot(doc.data());
                    }
                }, err => console.warn("Firestore Battle listener error:", err));
        } catch (e) {
            console.warn("Lưu Firestore battle_room lỗi (dùng local bus):", e);
        }
    }
}

// Xử lý khi có dữ liệu phòng cập nhật từ Firestore hoặc BroadcastChannel
function handleRoomSnapshot(data) {
    if (!data) return;
    battleRoomData = data;
    if (data.questions && data.questions.length > 0) {
        battleQuestions = data.questions;
    }

    // 1. Nếu đang ở màn hình Chờ
    const waitingScreen = document.getElementById('battle-waiting-modal');
    if (waitingScreen && !waitingScreen.classList.contains('hidden')) {
        updateWaitingRoomPlayers(data);
    }

    // 2. Nếu chủ phòng bấm Bắt đầu thi đấu
    if (data.status === 'starting' && !document.getElementById('battle-arena-screen').classList.contains('hidden-state-active')) {
        startMatchCountdown();
    }

    // 3. Nếu đang trong trận đấu: cập nhật thanh đua ngựa và đòn tấn công
    if (data.status === 'playing') {
        updateLiveRaceTrack(data);
        checkForIncomingAttacks(data);
    }
}

// Render giao diện Modal Phòng Chờ
function renderWaitingRoomUI() {
    const modal = document.getElementById('battle-waiting-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    // Hiển thị mã PIN 4 số
    const pinEl = document.getElementById('waiting-room-pin');
    if (pinEl) pinEl.innerText = battleRoomPin;

    // Tạo mã QR Code tự động
    const qrImg = document.getElementById('waiting-room-qr');
    if (qrImg) {
        const joinUrl = `${window.location.origin}${window.location.pathname}?battle_pin=${battleRoomPin}`;
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(joinUrl)}`;
    }

    // Cập nhật thông tin cấu hình
    const infoEl = document.getElementById('waiting-room-config-text');
    if (infoEl && battleRoomData) {
        infoEl.innerText = `Môn ${battleRoomData.config.subject} • Lớp ${battleRoomData.config.grade} • 10 Câu hỏi`;
    }

    updateWaitingRoomPlayers(battleRoomData);
}

function updateWaitingRoomPlayers(data) {
    // Player 1 (Host)
    const hostNameEl = document.getElementById('waiting-host-name');
    const hostAvatarEl = document.getElementById('waiting-host-avatar');
    if (hostNameEl && data.host) hostNameEl.innerText = data.host.name;
    if (hostAvatarEl && data.host) hostAvatarEl.innerText = data.host.avatar || '👑';

    // Player 2 (Guest)
    const guestContainer = document.getElementById('waiting-guest-card');
    const btnStart = document.getElementById('btn-battle-start-match');

    if (data.guest) {
        guestContainer.innerHTML = `
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-400 to-orange-500 text-white flex items-center justify-center text-3xl shadow-md animate-bounce">
                ${data.guest.avatar || '🦊'}
            </div>
            <div class="text-center">
                <div class="font-black text-gray-800 text-sm sm:text-base">${data.guest.name}</div>
                <div class="text-xs text-emerald-600 font-bold flex items-center justify-center gap-1 mt-0.5">
                    <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span> Đã sẵn sàng chiến đấu!
                </div>
            </div>
        `;
        if (btnStart) {
            btnStart.disabled = false;
            btnStart.classList.remove('opacity-50', 'cursor-not-allowed');
            btnStart.classList.add('animate-pulse');
        }
    } else {
        guestContainer.innerHTML = `
            <div class="w-16 h-16 rounded-2xl bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-2xl animate-pulse">
                <i class="fa-solid fa-user-plus"></i>
            </div>
            <div class="text-center">
                <div class="font-bold text-gray-500 text-xs sm:text-sm">Đang chờ đối thủ quét mã PIN...</div>
                <div class="text-[11px] text-gray-400 mt-0.5">Nhập mã <b>${battleRoomPin}</b> để vào</div>
            </div>
        `;
        if (btnStart) {
            btnStart.disabled = true;
            btnStart.classList.add('opacity-50', 'cursor-not-allowed');
            btnStart.classList.remove('animate-pulse');
        }
    }
}

// ==============================================================================
// 2. THAM GIA PHÒNG THI ĐẤU (GUEST JOIN)
// ==============================================================================

async function joinBattleRoomByPin(inputPin = null) {
    BattleAudio.init();
    const pin = (inputPin || document.getElementById('battle-join-pin')?.value || '').trim();
    if (!pin || pin.length < 4) {
        showToast("Vui lòng nhập đúng mã PIN 4 số của phòng đấu!");
        return;
    }

    battlePlayerRole = 'guest';
    battleRoomPin = pin;
    battleIsAiMode = false;
    battleScore = 0;
    battleStreak = 0;
    battleMaxStreak = 0;
    battlePowerUp = null;
    battleHasShield = false;
    battleCurrentQIndex = 0;
    battleProcessedAttackIds.clear();

    const guestUser = getBattlePlayerIdentity();

    // 1. Thử kết nối qua Firebase Firestore
    let joined = false;
    if (typeof firestoreDb !== 'undefined' && firestoreDb) {
        try {
            const roomRef = firestoreDb.collection('battle_rooms').doc(`room_${pin}`);
            const doc = await roomRef.get();
            if (doc.exists) {
                const rData = doc.data();
                if (rData.status !== 'waiting' && rData.status !== 'ready') {
                    showToast("Phòng đấu này đã bắt đầu hoặc đã kết thúc!");
                    return;
                }
                // Cập nhật guest vào phòng
                await roomRef.update({
                    guest: {
                        ...guestUser,
                        score: 0,
                        progress: 0,
                        currentQIndex: 0,
                        streak: 0,
                        finished: false
                    },
                    status: 'ready'
                });

                battleQuestions = rData.questions || [];
                battleRoomData = { ...rData, guest: guestUser, status: 'ready' };
                joined = true;

                // Lắng nghe thay đổi
                if (battleUnsubscribe) battleUnsubscribe();
                battleUnsubscribe = roomRef.onSnapshot((s) => {
                    if (s.exists) handleRoomSnapshot(s.data());
                });
            }
        } catch (e) {
            console.warn("Lỗi tham gia qua Firestore:", e);
        }
    }

    // 2. Nếu dùng BroadcastChannel nội bộ (giữa 2 tab trình duyệt trên cùng máy)
    if (!joined) {
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                if (battleChannel) battleChannel.close();
                battleChannel = new BroadcastChannel('steam_battle_room_' + pin);
                battleChannel.postMessage({
                    type: 'GUEST_JOINED',
                    guest: guestUser
                });
                battleChannel.onmessage = (ev) => {
                    if (ev.data && ev.data.type === 'ROOM_UPDATE') {
                        handleRoomSnapshot(ev.data.data);
                    }
                };
                joined = true;
            }
        } catch (e) { }
    }

    renderWaitingRoomUI();
    showToast(`Đã vào phòng thi đấu #${pin}! Chờ chủ phòng bắt đầu...`, 'success');
}

// Bấm nút "BẮT ĐẦU THI ĐẤU" (Chỉ Host bấm được)
async function triggerStartBattleMatch() {
    BattleAudio.init();
    if (!battleRoomData) return;

    battleRoomData.status = 'starting';

    // Bắn tin báo tới đối thủ
    if (battleChannel) {
        battleChannel.postMessage({ type: 'ROOM_UPDATE', data: battleRoomData });
    }
    if (typeof firestoreDb !== 'undefined' && firestoreDb && battleRoomPin) {
        try {
            await firestoreDb.collection('battle_rooms').doc(`room_${battleRoomPin}`).update({
                status: 'starting'
            });
        } catch (e) { }
    }

    startMatchCountdown();
}

function cancelBattleRoom() {
    if (battleUnsubscribe) battleUnsubscribe();
    if (battleChannel) battleChannel.close();
    if (battleAiInterval) clearInterval(battleAiInterval);
    const modal = document.getElementById('battle-waiting-modal');
    if (modal) modal.classList.add('hidden');
    battleRoomPin = null;
}

// ==============================================================================
// 3. ĐẾM NGƯỢC 3.. 2.. 1.. GO & VÀO ĐẤU TRƯỜNG
// ==============================================================================

function startMatchCountdown() {
    const modal = document.getElementById('battle-waiting-modal');
    if (modal) modal.classList.add('hidden');

    const countdownOverlay = document.getElementById('battle-countdown-overlay');
    const countdownNumber = document.getElementById('battle-countdown-number');
    if (!countdownOverlay || !countdownNumber) {
        enterBattleArena();
        return;
    }

    countdownOverlay.classList.remove('hidden');
    let count = 3;
    countdownNumber.innerText = count;
    BattleAudio.countdown(count);

    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            countdownNumber.innerText = count;
            countdownNumber.classList.add('scale-125');
            setTimeout(() => countdownNumber.classList.remove('scale-125'), 150);
            BattleAudio.countdown(count);
        } else if (count === 0) {
            countdownNumber.innerText = "CHIẾN! 🔥";
            countdownNumber.className = "text-5xl sm:text-7xl font-black text-amber-400 animate-pulse";
            BattleAudio.countdown(0);
        } else {
            clearInterval(timer);
            countdownOverlay.classList.add('hidden');
            enterBattleArena();
        }
    }, 900);
}

// Chuyển sang màn hình Đấu trường
function enterBattleArena() {
    // Ẩn tất cả các màn hình khác
    ['view-home', 'view-timetable', 'view-profile', 'view-grade', 'view-qa', 'view-settings', 'view-career', 'view-exam', 'exam-room-screen', 'exam-result-screen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const arenaScreen = document.getElementById('battle-arena-screen');
    if (arenaScreen) arenaScreen.classList.remove('hidden');

    battleCurrentQIndex = 0;
    battleScore = 0;
    battleStreak = 0;
    battleMaxStreak = 0;
    battlePowerUp = null;
    battleHasShield = false;
    battleIsFrozen = false;
    battleProcessedAttackIds.clear();

    // Khởi tạo đồ họa thanh đua ngựa
    initLiveRaceTrackUI();

    // Hiển thị câu hỏi đầu tiên
    renderBattleQuestion(0);

    // Kích hoạt Bot AI nếu chơi chế độ AI
    if (battleIsAiMode) {
        startBotAiSimulation();
    }
}

// ==============================================================================
// 4. THANH TIẾN ĐỘ "ĐUA NGỰA" TRỰC TIẾP (LIVE RACE TRACK)
// ==============================================================================

function initLiveRaceTrackUI() {
    const isHost = (battlePlayerRole === 'host');
    const myInfo = isHost ? battleRoomData.host : (battleRoomData.guest || getBattlePlayerIdentity());
    const oppInfo = isHost ? (battleRoomData.guest || { name: 'Đối thủ', avatar: '🏎️' }) : battleRoomData.host;

    // Làn đua 1: Bạn
    document.getElementById('race-my-name').innerText = myInfo.name || 'Bạn';
    document.getElementById('race-my-avatar').innerText = myInfo.avatar || '🚀';
    document.getElementById('race-my-score').innerText = '0 đ';
    document.getElementById('race-my-track-bar').style.width = '0%';

    // Làn đua 2: Đối thủ
    document.getElementById('race-opp-name').innerText = oppInfo.name || 'Đối thủ';
    document.getElementById('race-opp-avatar').innerText = oppInfo.avatar || '🏎️';
    document.getElementById('race-opp-score').innerText = '0 đ';
    document.getElementById('race-opp-track-bar').style.width = '0%';

    updateStreakUI();
}

// Cập nhật vị trí "Đua ngựa" của cả hai người chơi theo thời gian thực
function updateLiveRaceTrack(data) {
    if (!data) return;
    const isHost = (battlePlayerRole === 'host');
    const myData = isHost ? data.host : data.guest;
    const oppData = isHost ? data.guest : data.host;

    if (myData) {
        const myScoreEl = document.getElementById('race-my-score');
        const myBarEl = document.getElementById('race-my-track-bar');
        const myAvatarEl = document.getElementById('race-my-horse-runner');
        if (myScoreEl) myScoreEl.innerText = `${myData.score} đ`;
        if (myBarEl) myBarEl.style.width = `${Math.min(100, Math.round(myData.progress * 100))}%`;
        if (myAvatarEl) myAvatarEl.style.left = `${Math.min(95, Math.round(myData.progress * 95))}%`;
    }

    if (oppData) {
        const oppScoreEl = document.getElementById('race-opp-score');
        const oppBarEl = document.getElementById('race-opp-track-bar');
        const oppAvatarEl = document.getElementById('race-opp-horse-runner');
        if (oppScoreEl) oppScoreEl.innerText = `${oppData.score} đ`;
        if (oppBarEl) oppBarEl.style.width = `${Math.min(100, Math.round(oppData.progress * 100))}%`;
        if (oppAvatarEl) oppAvatarEl.style.left = `${Math.min(95, Math.round(oppData.progress * 95))}%`;

        // Nếu đối thủ đã làm xong đề
        if (oppData.finished && !document.getElementById('battle-opp-finish-badge')) {
            showToast(`Đối thủ ${oppData.name} đã hoàn thành bài thi với ${oppData.score} điểm! Hãy tăng tốc!`, 'info');
        }
    }
}

// ==============================================================================
// 5. HIỂN THỊ CÂU HỎI & XỬ LÝ TRẢ LỜI
// ==============================================================================

function renderBattleQuestion(qIndex) {
    if (qIndex >= battleQuestions.length) {
        finishBattleMatch();
        return;
    }

    battleCurrentQIndex = qIndex;
    battleQuestionStartTime = Date.now();
    const q = battleQuestions[qIndex];

    const numBadge = document.getElementById('battle-q-num-badge');
    const contentEl = document.getElementById('battle-q-content');
    const optionsGrid = document.getElementById('battle-q-options-grid');

    if (numBadge) numBadge.innerText = `CÂU ${qIndex + 1} / ${battleQuestions.length}`;
    if (contentEl) contentEl.innerText = q.content;

    if (optionsGrid) {
        optionsGrid.innerHTML = q.options.map((opt, idx) => {
            const letter = String.fromCharCode(65 + idx);
            return `
                <button type="button" onclick="selectBattleAnswer('${letter}', this)" class="battle-opt-btn p-3.5 sm:p-4 rounded-2xl border-2 border-indigo-100 bg-white hover:border-indigo-400 hover:bg-indigo-50/50 transition duration-150 text-left font-bold text-xs sm:text-sm text-gray-800 flex items-center gap-3 shadow-xs active:scale-98 group">
                    <span class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white transition flex items-center justify-center font-black text-sm shrink-0 border border-indigo-200">
                        ${letter}
                    </span>
                    <span class="flex-1">${opt.replace(/^[A-D]\.\s*/, '')}</span>
                </button>
            `;
        }).join('');
    }

    // Hiển thị render KaTeX nếu có công thức toán
    if (window.renderMathInElement && contentEl) {
        try { window.renderMathInElement(contentEl); } catch (e) { }
    }
}

// Bấm chọn đáp án
function selectBattleAnswer(selectedLetter, btnEl) {
    if (battleIsFrozen) {
        BattleAudio.wrong();
        showToast("❄️ Bạn đang bị đóng băng! Không thể chọn đáp án lúc này!", 'error');
        return;
    }

    const q = battleQuestions[battleCurrentQIndex];
    if (!q) return;

    // Vô hiệu hóa các nút còn lại để tránh spam
    const allBtns = document.querySelectorAll('.battle-opt-btn');
    allBtns.forEach(b => b.disabled = true);

    const isCorrect = (selectedLetter.toUpperCase() === q.correct.toUpperCase());
    const answerDuration = (Date.now() - battleQuestionStartTime) / 1000;

    if (isCorrect) {
        BattleAudio.correct();
        btnEl.classList.remove('border-indigo-100', 'bg-white');
        btnEl.classList.add('border-emerald-500', 'bg-emerald-50', 'text-emerald-900', 'ring-2', 'ring-emerald-400');

        // Tính điểm: 100 điểm cơ bản + điểm tốc độ (tối đa 50đ nếu trả lời dưới 5s)
        const speedBonus = Math.max(0, Math.round((10 - answerDuration) * 5));
        const addedScore = 100 + speedBonus;
        battleScore += addedScore;

        battleStreak++;
        if (battleStreak > battleMaxStreak) battleMaxStreak = battleStreak;

        // Nếu đạt chuỗi 3 câu đúng liên tiếp: Mở khóa vật phẩm kỹ năng!
        if (battleStreak % 3 === 0) {
            grantRandomPowerUp();
        }

        showScoreFloatAnimation(`+${addedScore} đ!`, btnEl);
    } else {
        BattleAudio.wrong();
        btnEl.classList.remove('border-indigo-100', 'bg-white');
        btnEl.classList.add('border-rose-500', 'bg-rose-50', 'text-rose-900');
        battleStreak = 0; // Đứt chuỗi

        // Hiển thị đáp án đúng
        allBtns.forEach(b => {
            const letter = b.querySelector('span')?.innerText.trim();
            if (letter === q.correct) {
                b.classList.add('border-emerald-500', 'bg-emerald-50', 'text-emerald-900');
            }
        });
    }

    updateStreakUI();

    // Tính tiến độ đường đua (% câu hoàn thành)
    const newProgress = (battleCurrentQIndex + 1) / battleQuestions.length;

    // Phát sóng cập nhật trạng thái lên hệ thống
    syncBattleProgress(battleScore, newProgress, battleCurrentQIndex + 1, battleStreak);

    // Chuyển sang câu tiếp theo sau 0.8s
    setTimeout(() => {
        renderBattleQuestion(battleCurrentQIndex + 1);
    }, 800);
}

// Đồng bộ điểm & tiến độ tới đối thủ
function syncBattleProgress(score, progress, qIdx, streak, isFinished = false) {
    const role = battlePlayerRole;
    const updateObj = {
        [`${role}.score`]: score,
        [`${role}.progress`]: progress,
        [`${role}.currentQIndex`]: qIdx,
        [`${role}.streak`]: streak,
        [`${role}.finished`]: isFinished
    };

    if (battleRoomData) {
        if (!battleRoomData[role]) battleRoomData[role] = {};
        battleRoomData[role].score = score;
        battleRoomData[role].progress = progress;
        battleRoomData[role].currentQIndex = qIdx;
        battleRoomData[role].streak = streak;
        battleRoomData[role].finished = isFinished;
    }

    // Cập nhật thanh đua ngựa local
    updateLiveRaceTrack(battleRoomData);

    // Gửi qua BroadcastChannel
    if (battleChannel) {
        battleChannel.postMessage({ type: 'ROOM_UPDATE', data: battleRoomData });
    }

    // Gửi qua Firebase Firestore
    if (typeof firestoreDb !== 'undefined' && firestoreDb && battleRoomPin) {
        try {
            firestoreDb.collection('battle_rooms').doc(`room_${battleRoomPin}`).update(updateObj);
        } catch (e) { }
    }
}

// ==============================================================================
// 6. HỆ THỐNG VẬT PHẨM & TƯƠNG TÁC THỜI GIAN THỰC (POWER-UPS)
// ==============================================================================

// Cập nhật thanh Combo Streak trên UI
function updateStreakUI() {
    const streakCountEl = document.getElementById('battle-streak-count');
    const streakFillEl = document.getElementById('battle-streak-meter-bar');
    if (streakCountEl) streakCountEl.innerText = battleStreak;

    if (streakFillEl) {
        const pct = Math.min(100, (battleStreak % 3) * 33.33);
        streakFillEl.style.width = pct + '%';
    }
}

// Nhận vật phẩm khi đúng 3 câu liên tiếp
function grantRandomPowerUp() {
    BattleAudio.powerUpReady();
    const powerUps = ['freeze', 'fog', 'scramble', 'shield'];
    const chosen = powerUps[Math.floor(Math.random() * powerUps.length)];
    battlePowerUp = chosen;

    const box = document.getElementById('battle-powerup-box');
    if (!box) return;

    const meta = {
        'freeze': { icon: '❄️', name: 'ĐÓNG BĂNG 3S', desc: 'Làm tê liệt màn hình đối thủ trong 3 giây!', cls: 'from-blue-500 to-cyan-400' },
        'fog': { icon: '🌫️', name: 'SƯƠNG MÙ CHE MẮT', desc: 'Phủ sương mù kín đề thi, đối thủ phải lấy tay lau mới đọc được!', cls: 'from-slate-600 to-gray-400' },
        'scramble': { icon: '🌀', name: 'GIÓ LỐC ĐẢO ĐÁP ÁN', desc: 'Hoán đổi lung tung 4 phương án của đối thủ!', cls: 'from-purple-500 to-pink-500' },
        'shield': { icon: '🛡️', name: 'KHIÊN BẢO VỆ', desc: 'Tự động chặn đứng đòn phá hoại tiếp theo từ đối thủ!', cls: 'from-amber-400 to-yellow-500' }
    };

    const p = meta[chosen];
    box.innerHTML = `
        <button type="button" onclick="activateBattlePowerUp()" class="w-full bg-gradient-to-r ${p.cls} text-white font-black p-3 rounded-2xl shadow-lg border-2 border-white/80 animate-bounce flex items-center justify-between gap-3 text-xs sm:text-sm hover:opacity-95 transition transform active:scale-95 cursor-pointer">
            <div class="flex items-center gap-2">
                <span class="text-2xl">${p.icon}</span>
                <div class="text-left">
                    <div class="leading-tight">${p.name}</div>
                    <div class="text-[10px] text-white/80 font-medium">${p.desc}</div>
                </div>
            </div>
            <div class="bg-white/30 px-3 py-1.5 rounded-xl uppercase tracking-wider text-[11px] font-black shrink-0">
                BẤM ĐỂ TUNG ĐÒN! 🔥
            </div>
        </button>
    `;
    showToast(`⚡ BẠN ĐÃ MỞ KHÓA VẬT PHẨM: ${p.name}! Hãy bấm để tung đòn bất ngờ!`, 'success');
}

// Kích hoạt vật phẩm tấn công đối thủ
function activateBattlePowerUp() {
    if (!battlePowerUp) return;
    BattleAudio.attack();

    const usedType = battlePowerUp;
    battlePowerUp = null;

    const box = document.getElementById('battle-powerup-box');
    if (box) box.innerHTML = '';

    // Nếu dùng Khiên: kích hoạt cho chính mình
    if (usedType === 'shield') {
        battleHasShield = true;
        BattleAudio.shield();
        showToast("🛡️ ĐÃ KÍCH HOẠT KHIÊN BẢO VỆ! Bạn được bảo vệ trước đòn tấn công tiếp theo!", 'info');
        return;
    }

    const attackEvent = {
        id: Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        from: battlePlayerRole,
        to: (battlePlayerRole === 'host') ? 'guest' : 'host',
        type: usedType,
        timestamp: Date.now()
    };

    // Nếu chơi với Bot AI: kích hoạt phản hồi của Bot
    if (battleIsAiMode) {
        showToast(`🚀 Đã tung đòn [${usedType.toUpperCase()}] thành công vào Bot AI!`, 'success');
        return;
    }

    // Gửi tấn công qua Firestore & BroadcastChannel
    if (battleRoomData) {
        if (!battleRoomData.attacks) battleRoomData.attacks = [];
        battleRoomData.attacks.push(attackEvent);
    }

    if (battleChannel) {
        battleChannel.postMessage({ type: 'ATTACK_EVENT', attack: attackEvent, data: battleRoomData });
    }

    if (typeof firestoreDb !== 'undefined' && firestoreDb && battleRoomPin) {
        try {
            firestoreDb.collection('battle_rooms').doc(`room_${battleRoomPin}`).update({
                attacks: firebase.firestore.FieldValue.arrayUnion(attackEvent)
            });
        } catch (e) { }
    }

    showToast(`🚀 ĐÃ TUNG ĐÒN TẤN CÔNG [${usedType.toUpperCase()}] VÀO ĐỐI THỦ!`, 'success');
}

// Kiểm tra xem có đòn tấn công nào từ đối thủ nhắm vào mình không
function checkForIncomingAttacks(data) {
    if (!data || !data.attacks || !Array.isArray(data.attacks)) return;
    const myRole = battlePlayerRole;

    data.attacks.forEach(att => {
        if (att.to === myRole && !battleProcessedAttackIds.has(att.id)) {
            battleProcessedAttackIds.add(att.id);
            receiveDebuffAttack(att.type);
        }
    });
}

// Nhận đòn tấn công từ đối thủ (Debuff)
function receiveDebuffAttack(type) {
    // 1. Kiểm tra Khiên chắn
    if (battleHasShield) {
        battleHasShield = false;
        BattleAudio.shield();
        showToast("🛡️ KHIÊN BẢO VỆ ĐÃ CHẶN ĐỨNG ĐÒN TẤN CÔNG TỪ ĐỐI THỦ!", 'success');
        return;
    }

    // 2. Xử lý từng loại debuff
    if (type === 'freeze') {
        applyFreezeDebuff();
    } else if (type === 'fog') {
        applyFogDebuff();
    } else if (type === 'scramble') {
        applyScrambleDebuff();
    }
}

// Kỹ năng 1: Đóng băng 3 giây
function applyFreezeDebuff() {
    BattleAudio.freeze();
    battleIsFrozen = true;
    const overlay = document.getElementById('battle-freeze-overlay');
    const timerText = document.getElementById('battle-freeze-timer');
    if (overlay) overlay.classList.remove('hidden');

    let left = 3.0;
    if (timerText) timerText.innerText = left.toFixed(1) + 's';

    const interval = setInterval(() => {
        left -= 0.1;
        if (left <= 0) {
            clearInterval(interval);
            battleIsFrozen = false;
            if (overlay) overlay.classList.add('hidden');
            showToast("🔥 Đã tan băng! Hãy tiếp tục làm bài!", 'info');
        } else if (timerText) {
            timerText.innerText = left.toFixed(1) + 's';
        }
    }, 100);
}

// Kỹ năng 2: Sương mù che mắt (Canvas Scratch-off: Phải lấy tay/chuột lau kính)
function applyFogDebuff() {
    BattleAudio.fog();
    const container = document.getElementById('battle-fog-container');
    const canvas = document.getElementById('battle-fog-canvas');
    if (!container || !canvas) return;

    container.classList.remove('hidden');
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width || 600;
    canvas.height = rect.height || 400;

    const ctx = canvas.getContext('2d');
    battleFogCtx = ctx;
    battleFogCanvas = canvas;
    battleFogPixelsCleared = 0;

    // Vẽ lớp sương mù mờ ảo dày đặc
    ctx.fillStyle = 'rgba(215, 228, 245, 0.96)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Vẽ giọt sương và hiệu ứng sương đọng
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    for (let i = 0; i < 40; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const r = Math.random() * 8 + 4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Vẽ dòng chữ hướng dẫn lau kính
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🌫️ ĐỐI THỦ VỪA THẢ SƯƠNG MÙ CHE MÀN HÌNH!', canvas.width / 2, canvas.height / 2 - 15);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#3b82f6';
    ctx.fillText('👉 Hãy dùng ngón tay hoặc chuột di qua di lại để LAU KÍNH!', canvas.width / 2, canvas.height / 2 + 15);

    // Thiết lập chế độ lau kính (Destination-out làm trong suốt phần vẽ)
    ctx.globalCompositeOperation = 'destination-out';

    function wipeAt(x, y) {
        ctx.beginPath();
        ctx.arc(x, y, 45, 0, Math.PI * 2);
        ctx.fill();
        battleFogPixelsCleared++;

        // Nếu đã lau được trên 40 lượt di: tự động tan biến sương mù
        if (battleFogPixelsCleared > 40) {
            container.classList.add('hidden');
            showToast("✨ Đã lau sạch sương mù!", 'success');
        }
    }

    canvas.onmousemove = (e) => {
        const r = canvas.getBoundingClientRect();
        wipeAt(e.clientX - r.left, e.clientY - r.top);
    };

    canvas.ontouchmove = (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        if (e.touches && e.touches[0]) {
            wipeAt(e.touches[0].clientX - r.left, e.touches[0].clientY - r.top);
        }
    };

    // Tự tan sau 7 giây nếu không lau
    setTimeout(() => {
        container.classList.add('hidden');
    }, 7000);
}

// Kỹ năng 3: Gió lốc đảo phương án
function applyScrambleDebuff() {
    BattleAudio.playTone(300, 'sine', 0.2, 0.2);
    const grid = document.getElementById('battle-q-options-grid');
    if (!grid) return;

    showToast("🌀 BẠN BỊ GIÓ LỐC! CÁC PHƯƠNG ÁN ĐÃ BỊ ĐẢO VỊ TRÍ!", 'error');
    grid.classList.add('animate-spin');
    setTimeout(() => grid.classList.remove('animate-spin'), 600);

    // Đảo ngẫu nhiên vị trí các thẻ button trong DOM
    const buttons = Array.from(grid.children);
    buttons.sort(() => Math.random() - 0.5);
    buttons.forEach(b => grid.appendChild(b));
}

// ==============================================================================
// 7. MÔ PHỎNG BOT AI (KHI THÁCH ĐẤU VỚI BOT)
// ==============================================================================

function startBotAiSimulation() {
    if (battleAiInterval) clearInterval(battleAiInterval);
    let botQIdx = 0;
    let botScore = 0;
    let botStreak = 0;

    battleAiInterval = setInterval(() => {
        if (botQIdx >= battleQuestions.length) {
            clearInterval(battleAiInterval);
            return;
        }

        botQIdx++;
        // Bot AI có xác suất trả lời đúng 85%
        const isBotCorrect = Math.random() < 0.85;
        if (isBotCorrect) {
            const botAdded = 100 + Math.floor(Math.random() * 40);
            botScore += botAdded;
            botStreak++;
            // Bot cũng có thể tung chiêu sương mù hoặc đóng băng bạn!
            if (botStreak === 3) {
                botStreak = 0;
                const debuffs = ['fog', 'freeze', 'scramble'];
                const botAttack = debuffs[Math.floor(Math.random() * debuffs.length)];
                setTimeout(() => {
                    showToast(`⚠️ BOT AI VỪA TUNG KỸ NĂNG [${botAttack.toUpperCase()}] VÀO BẠN!`, 'error');
                    receiveDebuffAttack(botAttack);
                }, 1000);
            }
        } else {
            botStreak = 0;
        }

        const botProgress = botQIdx / battleQuestions.length;

        // Cập nhật lên dữ liệu phòng
        if (battleRoomData && battleRoomData.guest) {
            battleRoomData.guest.score = botScore;
            battleRoomData.guest.progress = botProgress;
            battleRoomData.guest.currentQIndex = botQIdx;
            battleRoomData.guest.finished = (botQIdx >= battleQuestions.length);
        }

        updateLiveRaceTrack(battleRoomData);
    }, 3500 + Math.random() * 2500); // Mỗi câu bot làm từ 3.5s - 6s
}

// ==============================================================================
// 8. KẾT THÚC TRẬN ĐẤU & TRAO CÚP (RESULT SCREEN)
// ==============================================================================

function finishBattleMatch() {
    if (battleAiInterval) clearInterval(battleAiInterval);

    // Đánh dấu hoàn thành
    syncBattleProgress(battleScore, 1.0, battleQuestions.length, battleStreak, true);

    const arenaScreen = document.getElementById('battle-arena-screen');
    if (arenaScreen) arenaScreen.classList.add('hidden');

    const resultScreen = document.getElementById('battle-result-screen');
    if (resultScreen) resultScreen.classList.remove('hidden');

    const isHost = (battlePlayerRole === 'host');
    const myData = isHost ? (battleRoomData?.host || {}) : (battleRoomData?.guest || {});
    const oppData = isHost ? (battleRoomData?.guest || { score: 0, name: 'Đối thủ' }) : (battleRoomData?.host || { score: 0, name: 'Chủ phòng' });

    const myScore = battleScore;
    const oppScore = oppData.score || 0;

    const titleEl = document.getElementById('battle-result-title');
    const subtitleEl = document.getElementById('battle-result-subtitle');
    const cupImgEl = document.getElementById('battle-result-cup-icon');

    if (myScore > oppScore) {
        BattleAudio.victory();
        if (titleEl) titleEl.innerText = "🏆 CHIẾN THẮNG ÁP ĐẢO! 🏆";
        if (subtitleEl) subtitleEl.innerText = `Chúc mừng bạn đã xuất sắc đánh bại ${oppData.name || 'đối thủ'} với tỷ số nghẹt thở!`;
        if (cupImgEl) cupImgEl.innerText = "🥇";
        triggerBattleConfetti();
    } else if (myScore < oppScore) {
        BattleAudio.defeat();
        if (titleEl) titleEl.innerText = "🥈 BẠN ĐÃ THUA TRẬN!";
        if (subtitleEl) subtitleEl.innerText = `Đối thủ ${oppData.name || ''} đã bứt phá ngoạn mục. Đừng nản lòng, hãy bấm Tái Đấu ngay!`;
        if (cupImgEl) cupImgEl.innerText = "💪";
    } else {
        BattleAudio.victory();
        if (titleEl) titleEl.innerText = "🤝 BẤT PHÂN THẮNG BẠI (HÒA)!";
        if (subtitleEl) subtitleEl.innerText = "Cả hai đấu thủ đều ngang tài ngang sức với số điểm tuyệt đối!";
        if (cupImgEl) cupImgEl.innerText = "⚖️";
    }

    // Điền bảng chỉ số đối đầu
    document.getElementById('battle-res-my-name').innerText = myData.name || 'Bạn';
    document.getElementById('battle-res-my-score').innerText = `${myScore} đ`;
    document.getElementById('battle-res-opp-name').innerText = oppData.name || 'Đối thủ';
    document.getElementById('battle-res-opp-score').innerText = `${oppScore} đ`;
}

// Hiệu ứng pháo hoa chúc mừng
function triggerBattleConfetti() {
    const canvas = document.getElementById('battle-confetti-canvas');
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const particles = [];
    const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

    for (let i = 0; i < 100; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height * 0.4,
            r: Math.random() * 6 + 3,
            color: colors[Math.floor(Math.random() * colors.length)],
            vx: (Math.random() - 0.5) * 6,
            vy: Math.random() * 4 + 2,
            rot: Math.random() * 360
        });
    }

    let frame = 0;
    function anim() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
        });
        frame++;
        if (frame < 120) requestAnimationFrame(anim);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    anim();
}

function exitBattleToLobby() {
    if (battleUnsubscribe) battleUnsubscribe();
    if (battleChannel) battleChannel.close();
    if (battleAiInterval) clearInterval(battleAiInterval);

    ['battle-arena-screen', 'battle-result-screen', 'battle-waiting-modal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    if (typeof switchTab === 'function') {
        switchTab('exam');
        if (typeof setExamSubTab === 'function') setExamSubTab('battle');
    }
}

// Hiệu ứng điểm cộng bay lên
function showScoreFloatAnimation(text, targetEl) {
    if (!targetEl) return;
    const rect = targetEl.getBoundingClientRect();
    const floatEl = document.createElement('div');
    floatEl.innerText = text;
    floatEl.className = "fixed z-50 text-emerald-600 font-black text-lg pointer-events-none transition-all duration-700 ease-out animate-bounce";
    floatEl.style.left = (rect.left + rect.width / 2 - 25) + 'px';
    floatEl.style.top = (rect.top - 20) + 'px';
    document.body.appendChild(floatEl);

    setTimeout(() => {
        floatEl.style.transform = 'translateY(-35px)';
        floatEl.style.opacity = '0';
    }, 50);

    setTimeout(() => {
        if (floatEl.parentNode) floatEl.parentNode.removeChild(floatEl);
    }, 750);
}

function copyBattleRoomPin() {
    if (!battleRoomPin) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(battleRoomPin).then(() => {
            showToast("📋 Đã sao chép mã PIN phòng: " + battleRoomPin, 'success');
        }).catch(() => {
            showToast("Mã PIN phòng: " + battleRoomPin, 'info');
        });
    } else {
        showToast("Mã PIN phòng: " + battleRoomPin, 'info');
    }
}

// Tự động kiểm tra URL parameter ?battle_pin=XXXX để vào phòng ngay khi quét QR
function checkBattleUrlParams() {
    try {
        const params = new URLSearchParams(window.location.search);
        const pin = params.get('battle_pin');
        if (pin && pin.length >= 4) {
            setTimeout(() => {
                if (typeof switchTab === 'function') switchTab('exam');
                if (typeof setExamSubTab === 'function') setExamSubTab('battle');
                const pinInput = document.getElementById('battle-join-pin');
                if (pinInput) pinInput.value = pin;
                joinBattleRoomByPin(pin);
            }, 600);
        }
    } catch (e) { }
}

// Gắn toàn bộ hàm lên window
window.createBattleRoom = createBattleRoom;
window.joinBattleRoomByPin = joinBattleRoomByPin;
window.triggerStartBattleMatch = triggerStartBattleMatch;
window.cancelBattleRoom = cancelBattleRoom;
window.enterBattleArena = enterBattleArena;
window.finishBattleMatch = finishBattleMatch;
window.selectBattleAnswer = selectBattleAnswer;
window.activateBattlePowerUp = activateBattlePowerUp;
window.applyFogDebuff = applyFogDebuff;
window.applyFreezeDebuff = applyFreezeDebuff;
window.applyScrambleDebuff = applyScrambleDebuff;
window.exitBattleToLobby = exitBattleToLobby;
window.initBattleLobbyUI = initBattleLobbyUI;
window.copyBattleRoomPin = copyBattleRoomPin;
window.getBattleState = () => ({
    pin: battleRoomPin,
    role: battlePlayerRole,
    roomData: battleRoomData,
    questions: battleQuestions,
    score: battleScore,
    streak: battleStreak,
    currentQIndex: battleCurrentQIndex,
    isFrozen: battleIsFrozen
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initBattleLobbyUI();
        checkBattleUrlParams();
    });
} else {
    initBattleLobbyUI();
    checkBattleUrlParams();
}

