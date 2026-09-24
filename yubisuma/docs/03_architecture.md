# 03. 技術アーキテクチャ

## 1. 全体構成

```
┌────────────────────────┐        WebSocket (TLS)        ┌──────────────────────────────┐
│ クライアント (Godot 4)  │ ─────────────────────────────▶ │ ゲームサーバ (Node.js / TS)   │
│  + GodotSteam          │ ◀───────────────────────────── │  ├ 認証 (Steam チケット検証)  │
│  - 描画/入力/演出のみ   │                                │  ├ マッチメイカー             │
│  - ゲーム判定は持たない │                                │  ├ ゲームルーム (状態機械)     │
└──────────┬─────────────┘                                │  └ レート計算                 │
           │ Steamworks API                                └───────┬───────────┬──────────┘
           ▼                                                        │           │
   Steam（認証/フレンド/招待/実績/Rich Presence）              PostgreSQL     Redis
                                                              (ユーザ/戦績/  (待ち行列/
                                                               レート)        セッション)
```

### 技術選定の理由

| 要素 | 採用 | 候補と比較 |
| --- | --- | --- |
| クライアント | **Godot 4 (GDScript)** | Unity：高機能だが 2D ミニゲームには重い/ライセンス変動リスク。Electron+Web：手軽だが Steam 連携・パッド対応・配布サイズで劣る |
| Steam 連携 | **GodotSteam** | Godot 用 Steamworks ラッパーの定番 |
| サーバ | **Node.js + TypeScript + ws** | 既存プロジェクトで Node/ws の経験あり。ターン制で処理は軽い。クライアントと言語が違うので **ルールは JSON で定義し共通テストケースで一致を保証** |
| 通信 | WebSocket | ターン制で UDP は不要。Steam Networking(P2P) はランクのチート対策上不採用 |
| ホスティング | 初期：Render / Fly.io 東京など 1 台構成 | 同接数百までは 1 プロセスで十分。以降は水平分割（後述） |

## 2. サーバ権威とチート対策

- **判定はすべてサーバ**。クライアントは「入力を送る」「サーバからの状態を描画する」だけ
- 入力フェーズ中、他プレイヤーの入力値は **一切クライアントに送らない**（メモリ解析やパケット覗き見で漏れない）
- 締切はサーバ時刻で判定。締切後に届いた入力は破棄
  - 遅延補正：クライアントは入力にシーケンス番号を付与。締切後 **最大 100ms** 以内に届いたものは受理（RTT の揺らぎ吸収）。
    他人の入力が見えないので、この猶予は有利にならない
- 乱数（先手決定など）はサーバで生成
- レート操作（故意負け・談合）対策：同一相手との短時間の連戦でレート変動を減衰、通報機能＋ログ保存

## 3. ゲームルームの状態機械

```
WAITING_PLAYERS → COUNTDOWN → ROUND_ANNOUNCE → ROUND_INPUT → ROUND_REVEAL → ROUND_RESOLVE
                                     ▲                                             │
                                     └───────────── (ゲーム継続) ◀─────────────────┘
                                                                                   │ (決着)
                                                                   GAME_END → (BO3継続? COUNTDOWN) → MATCH_END
```

- 各状態は **サーバ側タイマー** で遷移。クライアントは受け取った `deadline`（サーバ時刻）と時刻オフセットでカウントダウン表示
- 時刻同期：接続時に ping を 5 回打ち、RTT 最小のサンプルからオフセットを算出

## 4. 通信プロトコル（JSON メッセージ案）

### クライアント → サーバ
| type | payload | 説明 |
| --- | --- | --- |
| `auth` | `{ steamTicket }` | Steam Web API 用認証チケット |
| `queue.join` | `{ mode: "ranked" \| "casual" }` | |
| `queue.leave` | `{}` | |
| `room.create` | `{ settings }` | プライベート |
| `room.join` | `{ code }` | |
| `match.accept` | `{ matchId }` | ランクの承認 |
| `input.thumbs` | `{ roundId, seq, left: bool, right: bool }` | 入力フェーズ中のみ |
| `input.call` | `{ roundId, seq, number }` | コーラーのみ |
| `emote` | `{ id }` | レート制限あり |

### サーバ → クライアント
| type | payload |
| --- | --- |
| `auth.ok` | `{ playerId, profile }` |
| `match.found` | `{ matchId, opponents, acceptDeadline }` |
| `game.state` | 全体スナップショット（再接続時にも使用） |
| `round.start` | `{ roundId, callerId, callRange, deadline }` |
| `round.reveal` | `{ roundId, thumbs: {playerId: n}, call, total, hit }` |
| `round.activity` | `{ playerId }`（実験：迷いインジケータ、値なし） |
| `game.end` / `match.end` | `{ placements, ratingDelta }` |

- すべてのメッセージに `v`（プロトコルバージョン）を付与。クライアントが古ければ接続時に更新を促す

## 5. データベース（PostgreSQL）

```sql
players        (id, steam_id UNIQUE, display_name, created_at, banned_until)
ratings        (player_id, mode, season_id, rating, rd, volatility, games, PRIMARY KEY(player_id, mode, season_id))
                -- mode: 'ranked' は Glicko-2, 'casual' は OpenSkill(mu, sigma を rating, rd 列に格納)
seasons        (id, starts_at, ends_at)
matches        (id, mode, season_id, started_at, ended_at, settings JSONB)
match_players  (match_id, player_id, placement, rating_before, rating_after, disconnected)
rounds         (match_id, game_no, round_no, caller_id, call, inputs JSONB, hit)
                -- 癖の統計・不正調査・将来のリプレイ用。一定期間後に集計して間引く
reports        (id, reporter_id, target_id, match_id, reason, created_at)
```

## 6. Steam 連携

| 機能 | 使う API |
| --- | --- |
| ログイン | クライアント `GetAuthTicketForWebApi` → サーバが `ISteamUserAuth/AuthenticateUserTicket` で検証 → 自前のセッショントークン発行 |
| 名前・アイコン | Steam のペルソナ名/アバター |
| フレンド招待 | Rich Presence の `connect` にルームコードを設定、`GameRichPresenceJoinRequested` で参加 |
| 実績 | 「初勝利」「ゼロで当てる」「マスター到達」など |
| リーダーボード | 自前 DB が正。表示のみ Steam Leaderboard に同期しても良い（任意） |
| クラウドセーブ | 設定のみ（キー配置・音量）。戦績はサーバにあるので不要 |

## 7. スケーリング方針

1. **段階1**（〜同接 500）：Node 1 プロセスにマッチメイカーとルームを同居
2. **段階2**：ルームサーバを複数台化。マッチメイカーを分離し、Redis Pub/Sub でルーム割り当て。
   接続はルームサーバへ直接（割り当て時にアドレスとワンタイムトークンを渡す）
3. 海外展開時：リージョン別にルームサーバを配置

## 8. リポジトリ構成（実装開始時の案）

```
yubisuma/
├─ client/           # Godot プロジェクト
├─ server/
│  ├─ src/rules/     # 純粋関数のルールエンジン（状態 + 入力 → 次状態）
│  ├─ src/room/      # 状態機械・タイマー
│  ├─ src/match/     # マッチメイカー
│  ├─ src/rating/    # Glicko-2 / OpenSkill
│  └─ test/
├─ shared/
│  ├─ protocol.json  # メッセージ定義（クライアント/サーバ共通）
│  └─ rule-cases/    # ルールのテストケース（両実装で同じ結果になるか検証）
└─ docs/
```

- ルールエンジンは **副作用のない純粋関数** にし、CPU 対戦・サーバ・テストで共用
- ロードテスト：ヘッドレス Bot クライアントで 1000 同時ルームを負荷試験
