const restaurantDB = [
            { id: 1, store: "駅前大衆食堂", menu: "名物から揚げ定食", price: 850, tags: ["gatturi", "bakuyasu"] },
            { id: 2, store: "カフェ・ド・パリ", menu: "アボカドチーズバーガー", price: 1300, tags: ["bae"] },
            { id: 3, store: "激辛麻婆楼", menu: "極辛四川麻婆豆腐", price: 950, tags: ["gatturi", "karai"] },
            { id: 4, store: "下町ピッツェリア", menu: "マルゲリータピザ", price: 1100, tags: ["bae", "bakuyasu"] },
            { id: 5, store: "ほっこり和食処", menu: "本日の焼き魚御膳", price: 900, tags: [] },
            { id: 6, store: "レッドドラゴン", menu: "激辛牛肉ヌードル", price: 880, tags: ["gatturi", "karai"] }
        ];

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

        // ================= ソロモード実行ロジック =================
        function executeSoloMatching() {
            const name = document.getElementById('solo-name').value || "自分";
            const maxPrice = parseInt(document.getElementById('solo-max-price').value) || 1000;
            const checkedTags = Array.from(document.querySelectorAll('input[name="solo-tag"]:checked')).map(el => el.value);

            const result = runJSMatching(maxPrice, checkedTags);
            if (!result) {
                alert("条件に一致するメニューが見つかりませんでした。予算やタグを変更してみてください！");
                return;
            }

            document.getElementById('solo-section').classList.add('hidden');
            showRouletteAnimation(`${name}さんのチョイス`, result.store, result.menu);
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
            conn.on('data', (data) => {
                // ホスト側またはゲスト側がデータを受信した時の処理
                if (peer && peer.id && !hostData) {
                    // ホストがゲストからのデータを受け取った場合
                    hostData = data; // ゲストのデータを保持
                } else {
                    // ゲストがホストからの最終結果データを受け取った場合
                    executeRoomMatchingSync(data.host, data.guest);
                }
            });
        }

        function submitRoomDecision() {
            const name = document.getElementById('room-name').value || "メンバー";
            const price = parseInt(document.getElementById('room-max-price').value) || 1000;
            const tags = Array.from(document.querySelectorAll('input[name="room-tag"]:checked')).map(el => el.value);

            const myData = { name, price, tags };

            if (conn && conn.open) {
                if (!hostData && conn.peer) {
                    // 自分がゲストの場合：ホストへ自分のデータを送信し、ホストからの計算結果を待つ
                    conn.send(myData);
                    document.getElementById('room-status-text').innerText = "ホストの決定を待っています...";
                } else {
                    // 自分がホストの場合：ゲストのデータ(hostData)と自分のデータ(myData)が揃ったので計算してブロードキャスト
                    executeRoomMatchingSync(hostData || { name: "ホスト", price, tags: [] }, myData);
                }
            }
        }

        function executeRoomMatchingSync(p1, p2) {
            // 2人の厳しい方の予算を採用し、タグを結合
            const combinedPrice = Math.min(p1.price, p2.price);
            const combinedTags = [...new Set([...p1.tags, ...p2.tags])];

            const result = runJSMatching(combinedPrice, combinedTags);
            
            // ホスト側ならゲストへ結果を送信
            if (conn && conn.open && hostData) {
                conn.send({ host: p1, guest: p2, result });
            }

            document.getElementById('room-section').classList.add('hidden');
            showRouletteAnimation(`${p1.name} & ${p2.name} の共同決定`, result ? result.store : "該当なし", result ? result.menu : "メニューなし");
        }

        // ================= コア：JSマッチングエンジン =================
        function runJSMatching(maxPrice, userTags) {
            // 1. 予算内でフィルタリング
            let candidates = restaurantDB.filter(item => item.price <= maxPrice);

            if (candidates.length === 0) return null;

            // 2. タグの一致数をスコアリング
            candidates = candidates.map(item => {
                let score = item.tags.filter(t => userTags.includes(t)).length;
                return { ...item, score };
            });

            // 3. スコア順（高い順）にソート
            candidates.sort((a, b) => b.score - a.score);

            // 4. 最高スコアのグループを抽出してランダム選出
            const topScore = candidates[0].score;
            const topGroup = candidates.filter(item => item.score === topScore);
            const selected = topGroup[Math.floor(Math.random() * topGroup.length)];

            return selected;
        }

        // ================= ルーレット演出 ＆ マップリンク生成 =================
        function showRouletteAnimation(participantsText, storeName, menuName) {
            document.getElementById('result-section').classList.remove('hidden');
            document.getElementById('res-participants').innerText = participantsText;
            const storeEl = document.getElementById('res-store');
            const menuEl = document.getElementById('res-menu');
            const mapLinkEl = document.getElementById('res-map-link');

            // マップボタンを一時非課税・非表示にしておく
            mapLinkEl.classList.add('opacity-50', 'pointer-events-none');
            
            const dummyMenus = [
                "から揚げ定食を探中...", "オムライスを探中...", "ラーメンを探中...", 
                "ハンバーグを探中...", "パスタを探中...", "焼肉を探中..."
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

                // Googleマップの検索URLを動的に生成
                const mapQuery = encodeURIComponent(storeName);
                mapLinkEl.href = `https://www.google.com/maps/search/?api=1&query=${mapQuery}`;
                mapLinkEl.classList.remove('opacity-50', 'pointer-events-none');
            }, 1500);
        }