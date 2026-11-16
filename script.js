let peer = null;
let conn = null;
let hostData = null; // ルームマッチ用

// 画面・モード切り替え
function switchMode(mode) {
    document.getElementById('mode-select-section').classList.add('hidden');
    document.getElementById('result-section').classList.add('hidden');
    
    if (mode === 'solo') {
        document.getElementById('solo-section').classList.remove('hidden');
    } else if (mode === 'room') {
        document.getElementById('room-section').classList.remove('hidden');
    }
}

function backToHome() {
    document.getElementById('mode-select-section').classList.remove('hidden');
    document.getElementById('solo-section').classList.add('hidden');
    document.getElementById('room-section').classList.add('hidden');
    document.getElementById('result-section').classList.add('hidden');
    document.getElementById('room-decision-area').classList.add('hidden');
    if (peer) { peer.destroy(); peer = null; }
    conn = null;
    hostData = null;
}

// ================= 1. 位置情報 ＆ リアルマップAPI（Overpass API）連携 =================
async function fetchNearbyRestaurants() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("お使いのブラウザは位置情報（GPS）に対応していません。"));
            return;
        }

        navigator.geolocation.getCurrentPosition(async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            // OpenStreetMapのOverpass API（無料・キー不要）を使って半径1km以内の飲食店を取得
            const query = `
                [out:json][timeout:15];
                (
                  node["amenity"~"restaurant|cafe|fast_food|bar"](around:1000,${lat},${lon});
                );
                out body;
            `;
            const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`地図サーバーとの通信に失敗しました（ステータス: ${response.status}）`);
                }
                const data = await response.json();

                const restaurants = data.elements
                    .filter(el => el.tags && el.tags.name)
                    .map((el, index) => {
                        const name = el.tags.name;
                        const tags = [];
                        if (name.includes("カフェ") || name.includes("Coffee") || name.includes("Starbucks") || name.includes("ドトール")) tags.push("bae");
                        if (name.includes("ラーメン") || name.includes("食堂") || name.includes("弁当") || name.includes("うどん")) tags.push("gatturi");
                        if (name.includes("丼") || name.includes("松屋") || name.includes("吉野家") || name.includes("すき家")) tags.push("bakuyasu");
                        
                        return {
                            id: index + 1,
                            store: name,
                            menu: el.tags.cuisine ? `${el.tags.cuisine}系メニュー` : "おすすめ看板メニュー",
                            price: Math.floor(Math.random() * 700) + 600,
                            tags: tags.length > 0 ? tags : ["gatturi", "bakuyasu"]
                        };
                    });

                if (restaurants.length === 0) {
                    reject(new Error("現在地の周辺（半径1km以内）に飲食店データが見つかりませんでした。"));
                } else {
                    resolve(restaurants);
                }
            } catch (e) {
                reject(new Error(`周辺店舗データの取得に失敗しました: ${e.message}`));
            }
        }, (error) => {
            let errorMsg = "位置情報を取得できませんでした。";
            if (error.code === error.PERMISSION_DENIED) {
                errorMsg = "位置情報の利用が拒否されました。ブラウザの設定から位置情報を許可してください。";
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                errorMsg = "現在地の位置情報を特定できませんでした。電波の良い場所で再度お試しください。";
            } else if (error.code === error.TIMEOUT) {
                errorMsg = "位置情報の取得がタイムアウトしました。再度お試しください。";
            }
            reject(new Error(errorMsg));
        }, { timeout: 10000 });
    });
}

// ================= ソロモード実行ロジック =================
async function executeSoloMatching() {
    const name = document.getElementById('solo-name').value || "自分";
    const maxPrice = parseInt(document.getElementById('solo-max-price').value) || 1200;
    const checkedTags = Array.from(document.querySelectorAll('input[name="solo-tag"]:checked')).map(el => el.value);

    const statusEl = document.getElementById('app-status');
    statusEl.innerText = "📍 周辺の飲食店データをスキャン中...";

    try {
        const restaurantDB = await fetchNearbyRestaurants();
        statusEl.innerText = "JavaScriptエンジン稼働中";

        const result = runJSMatching(restaurantDB, maxPrice, checkedTags);
        if (!result) {
            alert("条件に一致するメニューが見つかりませんでした。予算やタグを変更してみてください！");
            return;
        }

        document.getElementById('solo-section').classList.add('hidden');
        showRouletteAnimation(`${name}さんのチョイス`, result.store, result.menu);
    } catch (err) {
        statusEl.innerText = "⚠️ データ取得エラー";
        alert(`エラー: ${err.message}`);
    }
}

// ================= ルームマッチ（P2P）ロジック =================
function createRoom() {
    peer = new Peer();
    peer.on('open', (id) => {
        document.getElementById('room-status-text').innerText = `部屋ID: ${id}\n（このIDを友達に伝えてください）`;
    });
    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
        document.getElementById('room-status-text').innerText = "✨ 友達が接続しました！条件を入力して送信してください。";
        document.getElementById('room-decision-area').classList.remove('hidden');
    });
}

function joinRoom() {
    const hostId = document.getElementById('room-id-input').value;
    if (!hostId) { alert("部屋IDを入力してください"); return; }
    
    peer = new Peer();
    peer.on('open', () => {
        conn = peer.connect(hostId);
        setupConnection();
        document.getElementById('room-status-text').innerText = "✨ 部屋に接続しました！条件を入力して送信してください。";
        document.getElementById('room-decision-area').classList.remove('hidden');
    });
}

function setupConnection() {
    conn.on('data', async (data) => {
        if (data.error) {
            // ホスト側でエラーが起きた場合、ゲスト側にもエラーを通知
            alert(`ホスト側でエラーが発生しました:\n${data.error}`);
            document.getElementById('room-status-text').innerText = "⚠️ データの取得に失敗しました。再度お試しください。";
            return;
        }

        if (peer && peer.id && !hostData) {
            hostData = data;
        } else {
            executeRoomMatchingSync(data.host, data.guest, data.result);
        }
    });
}

async function submitRoomDecision() {
    const name = document.getElementById('room-name').value || "メンバー";
    const price = parseInt(document.getElementById('room-max-price').value) || 1200;
    const tags = Array.from(document.querySelectorAll('input[name="room-tag"]:checked')).map(el => el.value);

    const myData = { name, price, tags };

    if (conn && conn.open) {
        if (!hostData && conn.peer) {
            // ゲスト側：ホストへデータを送信
            conn.send(myData);
            document.getElementById('room-status-text').innerText = "ホストの決定を待っています...";
        } else {
            // ホスト側：リアル店舗データを取得してマッチング計算を実行
            const statusEl = document.getElementById('app-status');
            statusEl.innerText = "📍 周辺の飲食店データをスキャン中...";

            try {
                const restaurantDB = await fetchNearbyRestaurants();
                statusEl.innerText = "JavaScriptエンジン稼働中";

                const combinedPrice = Math.min(hostData.price, myData.price);
                const combinedTags = [...new Set([...hostData.tags, ...myData.tags])];
                const result = runJSMatching(restaurantDB, combinedPrice, combinedTags);

                conn.send({ host: hostData, guest: myData, result });
                executeRoomMatchingSync(hostData, myData, result);
            } catch (err) {
                statusEl.innerText = "⚠️ データ取得エラー";
                alert(`エラー: ${err.message}`);
                // ゲスト側にもエラーが起きたことを伝える
                conn.send({ error: err.message });
            }
        }
    }
}

function executeRoomMatchingSync(p1, p2, result) {
    document.getElementById('room-section').classList.add('hidden');
    showRouletteAnimation(
        `${p1.name} & ${p2.name} の共同決定`, 
        result ? result.store : "該当店舗なし", 
        result ? result.menu : "メニューなし"
    );
}

// ================= コア：JSマッチングエンジン =================
function runJSMatching(db, maxPrice, userTags) {
    let candidates = db.filter(item => item.price <= maxPrice);
    if (candidates.length === 0) candidates = db;

    candidates = candidates.map(item => {
        let score = item.tags.filter(t => userTags.includes(t)).length;
        return { ...item, score };
    });

    candidates.sort((a, b) => b.score - a.score);
    const topScore = candidates[0].score;
    const topGroup = candidates.filter(item => item.score === topScore);
    return topGroup[Math.floor(Math.random() * topGroup.length)];
}

// ================= ルーレット演出 ＆ マップリンク生成 =================
function showRouletteAnimation(participantsText, storeName, menuName) {
    document.getElementById('result-section').classList.remove('hidden');
    document.getElementById('res-participants').innerText = participantsText;
    const storeEl = document.getElementById('res-store');
    const menuEl = document.getElementById('res-menu');
    const mapLinkEl = document.getElementById('res-map-link');

    mapLinkEl.classList.add('opacity-50', 'pointer-events-none');
    
    const dummyMenus = [
        "近くの店をスキャン中...", "美味しい匂いを感知中...", "候補を絞り込み中...", 
        "お店を選定中...", "運命の決定まであと少し..."
    ];

    let count = 0;
    storeEl.innerText = "🎲 ルーレット抽選中...";
    
    const shuffleInterval = setInterval(() => {
        menuEl.innerText = dummyMenus[count % dummyMenus.length];
        count++;
    }, 100);

    setTimeout(() => {
        clearInterval(shuffleInterval);
        storeEl.innerText = storeName;
        menuEl.innerText = `✨ ${menuName}`;

        const mapQuery = encodeURIComponent(storeName);
        mapLinkEl.href = `https://www.google.com/maps/search/?api=1&query=${mapQuery}`;
        mapLinkEl.classList.remove('opacity-50', 'pointer-events-none');
    }, 1500);
}