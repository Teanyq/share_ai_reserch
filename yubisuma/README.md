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

操作：`A` 左の親指 / `D` 右の親指 / 数字キー コール / `Space` 決定（マウスでも可）。
全員が決定した時点で答えが出る（最大 10 秒）。コーラーが数字を選ばずに決定すると「0」でコールしたことになる。

### 友達とネット越しに遊ぶ（Web 版を公開）

サーバは Godot の **Web 版クライアントも一緒に配信** します。公開すれば、友達は URL を開くだけでブラウザから遊べます（Godot のインストール不要）。

**Fly.io で公開する手順**（東京リージョン。Windows の PowerShell で実行）

事前に https://fly.io でアカウントを作り、クレジットカードを登録しておく
（従量課金。この構成は 1 台・未使用時は自動停止なので、目安は最大でも月 2 ドル程度）。

```powershell
# 1. Fly.io のコマンド（flyctl）を入れて、ターミナルを開き直してからログイン
iwr https://fly.io/install.ps1 -useb | iex
fly auth login

# 2. コードを取得（git が無ければ GitHub の「Code → Download ZIP」でも可）
git clone -b claude/exciting-shannon-bj9xlz https://github.com/teanyq/share_ai_reserch.git
cd share_ai_reserch\yubisuma\server

# 3. アプリ名を決める（全世界で重複しない英小文字・数字・ハイフン）
$app = "yubisuma-xxxx"

# 4. アプリとデータ保存用ボリュームを作る（初回だけ。ボリュームの警告には y）
fly apps create $app
fly volumes create yubisuma_data --region nrt --size 1 -a $app

# 5. デプロイ（ビルドは Fly.io 側で行うので Docker は不要）
fly deploy -a $app --ha=false
```

数分で `https://<アプリ名>.fly.dev` が使えるようになるので、その URL を友達に送る。
プライベートマッチは、ルームを作ったあと「招待 URL をコピー」で送れば、開くだけで同じルームに入れる。

- **マシンは必ず 1 台**（`--ha=false`）。ルームやマッチング待ちはサーバのメモリ上にあるため、2 台に分かれると同じ部屋に入れない
- 誰も繋いでいないと自動で止まり、アクセスが来ると数秒で起動する
- レートなどはボリューム（`/data`）に保存されるので、停止・再デプロイでも消えない
- 更新するとき：`git pull` → `fly deploy -a $app --ha=false`
- ログを見るとき：`fly logs -a $app`

（別案：Render でも動きます。`yubisuma/render.yaml` を Blueprint として使うか、Root Directory を `yubisuma/server` にした Web Service を作る。ただし一部のネットワークでは `onrender.com` が遮断されている）

デスクトップ版（Godot から実行）で公開サーバに繋ぐときは、「サーバ」欄を `wss://<アプリ名>.fly.dev/ws` にします。

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
| 保存 | `profiles.json`（Fly.io ではボリュームの `/data`） | PostgreSQL |
| カジュアルの内部レート | なし | OpenSkill |
| シーズン・降格保護・ペナルティ段階 | なし | 02 参照 |
| 絵・音 | コードで描いた仮の絵、合成した電子音 | 外注 or 自作 |
| フォント | M PLUS Rounded 1c を同梱（OFL） | 本番フォントは要検討 |

> このリポジトリ（share_ai_reserch）とは別プロジェクトです。実装フェーズに入るときは
> 専用リポジトリへ切り出すことを推奨します。

## コンセプト

- **ルールは誰でも知っている指スマ、でも読み合いはガチ**
- 1試合 1〜2 分。「もう1戦」が止まらないテンポ
- 対面の「せーの！」を **全員の「決定」がそろった瞬間の一斉公開** で再現する

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
| 入力方式 | 全員が「決定」したら一斉公開（最大 10 秒） | ラグがあっても公平。後出しが原理的に不可能 |
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
