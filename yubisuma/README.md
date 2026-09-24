# YUBISUMA ONLINE（仮）— オンライン指スマ

オンラインで遊べる「指スマ（いっせーので）」を Steam でリリースするためのプロジェクトです。
現在は **プロトタイプ（M0〜M1 相当）** の段階です。

- `server/` … ゲームサーバ（Node.js + TypeScript + WebSocket）
- `client/` … ゲームクライアント（Godot 4.4）。Web 版の書き出し結果は `server/public/`
- `docs/` … 設計ドキュメント

## プロトタイプの動かし方

必要なもの：Node.js 22.18 以上、[Godot 4.4](https://godotengine.org/download/)（標準版、.NET 版ではない）

```bash
# 1. サーバを起動（ws://localhost:8787/ws）
cd yubisuma/server
npm install
npm start          # 本番と同じテンポ
# npm run dev      # 動作確認用：入力 0.6 秒・演出短縮・カジュアルの CPU 補充 3 秒
```

2. Godot で `yubisuma/client/project.godot` を開き、F5 で実行
3. タイトル画面で遊び方を選ぶ
   - **CPU 練習**：1 人ですぐ遊べる（CPU 1〜3 体、Lv1 ランダム / Lv2 相手の癖を読む）
   - **ランクマッチ**：2 人で同時に押すとマッチング。1 台で試すときはエディタの
     「デバッグ → 実行インスタンスをカスタマイズ」でインスタンス数を 2 にし、2 つ目の起動引数に `--guest` を指定
     （同じ PC の保存トークンを共有しないようにするため）
   - **カジュアル**：20 秒待って 4 人揃わなければ CPU で補充
   - **ルームを作る**：6 文字のコードを友達に伝えて「ルームに参加」。CPU 追加・入力時間・先取数などを設定可能

操作：`F` 左の親指 / `J` 右の親指 / 数字キー コール（マウスでも可）

### 友達とネット越しに遊ぶ（Web 版を公開）

サーバは Godot の **Web 版クライアントも一緒に配信** します。公開すれば、友達は URL を開くだけでブラウザから遊べます（Godot のインストール不要）。

**Render（無料）で公開する手順**

1. https://dashboard.render.com で **New → Web Service** を選び、GitHub の `teanyq/share_ai_reserch` を選ぶ
2. 次のように設定して **Deploy** を押す

   | 項目 | 値 |
   | --- | --- |
   | Branch | `claude/exciting-shannon-bj9xlz`（main にマージした後は `main`） |
   | Region | Singapore（日本に一番近い） |
   | Root Directory | `yubisuma/server` |
   | Runtime / Build Command / Start Command | Node / `npm install` / `npm start` |
   | Instance Type | Free |
   | Health Check Path（Advanced） | `/healthz` |
   | Environment Variables | `NODE_VERSION` = `22.22.0` |

   （Blueprint を使う場合は New → Blueprint で Blueprint Path に `yubisuma/render.yaml` を指定しても同じ設定になります）
3. 数分で `https://〇〇.onrender.com` が発行されるので、その URL を友達に送る
4. プライベートマッチは、ルームを作ったあと「招待 URL をコピー」で送れば、開くだけで同じルームに入れる

無料プランの注意：
- 15 分アクセスがないとスリープし、次に開いたとき起動に 1 分ほどかかる
- ディスクが保存されないので、再デプロイや再起動でレートがリセットされる

デスクトップ版（Godot から実行）で公開サーバに繋ぐときは、「サーバ」欄を `wss://〇〇.onrender.com/ws` にします。

**Web 版を作り直す**（クライアントを変更したとき）

```bash
GODOT=/path/to/godot ./yubisuma/client/export_web.sh   # server/public/ に書き出し → commit & push
```

事前に Godot エディタの「エディタ → エクスポートテンプレートの管理」でテンプレート（4.4.1）を入れておく必要があります。

### テスト

```bash
cd yubisuma/server
npm test           # ルール・CPU・レート・WebSocket 経由の対戦（プライベート/ランク/棄権/再接続/カジュアル補充）
npm run typecheck
```

Godot クライアントは自動プレイで動作確認できます（サーバを `npm run dev` で起動しておく）：

```bash
godot --headless --path yubisuma/client -- --autoplay=practice   # practice / casual / ranked / room
```

### プロトタイプで割り切っていること

| 項目 | 現状 | 本実装（設計書） |
| --- | --- | --- |
| ログイン | サーバが発行するトークンをローカル保存 | Steam 認証チケット |
| 保存 | `server/data/profiles.json` | PostgreSQL |
| カジュアルの内部レート | なし | OpenSkill |
| シーズン・降格保護・ペナルティ段階 | なし | 02 参照 |
| 絵・音 | コードで描いた仮の手、音なし | 外注 or 自作 |
| フォント | M PLUS Rounded 1c を同梱（OFL） | 本番フォントは要検討 |

> このリポジトリ（share_ai_reserch）とは別プロジェクトです。実装フェーズに入るときは
> 専用リポジトリへ切り出すことを推奨します。

## コンセプト

- **ルールは誰でも知っている指スマ、でも読み合いはガチ**
- 1試合 1〜2 分。「もう1戦」が止まらないテンポ
- 対面の「せーの！」の緊張感を **短い同時入力ウィンドウ（制限時間）** で再現する

## モード一覧（要件）

| モード | 人数 | レート | 概要 |
| --- | --- | --- | --- |
| ランクマッチ | 1v1 | あり（公開ランク） | BO3。シーズン制・ランク帯あり |
| カジュアルマッチ | 2〜4人 | 内部レートのみ | 人が足りなければ CPU で補充 |
| プライベートマッチ | 2〜4人 | なし | ルームコード / Steam フレンド招待。ルール自由設定 |

## ドキュメント

1. [ゲームルールとオンライン向けの工夫](docs/01_game_rules.md)
2. [モード・マッチメイキング・レート設計](docs/02_modes_rating.md)
3. [技術アーキテクチャ（クライアント / サーバ / 通信 / DB）](docs/03_architecture.md)
4. [Steam リリース計画とロードマップ](docs/04_steam_and_roadmap.md)

## 主要な決定事項（サマリ）

| 項目 | 決定（案） | 理由 |
| --- | --- | --- |
| 入力方式 | 同時入力ウィンドウ（ランク 3.0 秒）→ 一斉公開 | ラグがあっても公平。後出しが原理的に不可能 |
| 権威 | 完全サーバ権威（入力は締切まで他者に送らない） | ランクがあるのでチート対策が最優先 |
| クライアント | Godot 4 + GodotSteam（**決定**） | 2D 軽量ゲームに最適、無料、Steam 連携プラグインあり |
| サーバ | Node.js (TypeScript) + WebSocket | 既存の Node 知見を活かせる。ターン制なので十分な性能 |
| DB | PostgreSQL（永続）+ Redis（マッチング待ち行列） | 定番構成 |
| レート | ランク: Glicko-2 / カジュアル: OpenSkill（多人数順位対応） | 1v1 と多人数で最適なアルゴリズムが違う |
| 販売形態 | 低価格の買い切り（例: 500円前後、**決定**）＋ 見た目系 DLC は後で検討 | サブ垢・チート抑止、ストア審査が楽 |

## 最大のリスク

**人口（同時接続数）**。1v1 ランクは人がいないと成立しません。
→ カジュアルの CPU 補充、ランクの待ち時間に応じた検索範囲拡大、フレンド招待導線、
Steam Playtest での事前母集団づくりで対策します（詳細は 04）。
