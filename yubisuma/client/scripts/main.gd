## プロトタイプのメイン画面。UI はすべてコードで組み立てる（素材なしで動かすため）。
## 画面：タイトル / マッチング待ち / ロビー（プライベート） / 対戦
##
## コマンドライン（`godot -- --autoplay=practice` など）で自動プレイでき、動作確認に使う。
extends Control

const SETTINGS_PATH := "user://settings.cfg"
const DEFAULT_SERVER := "ws://localhost:8787/ws"
const EMOTES := ["よろしく！", "読めてるよ", "ゼロでしょ？", "せーの！", "ナイス！", "あぶなっ", "そこかー", "GG"]
const MODE_NAMES := {"private": "プライベート", "casual": "カジュアル", "ranked": "ランク", "practice": "CPU練習"}

var net: Net
var cfg := ConfigFile.new()
var my_id := ""
var state: Dictionary = {}
var phase_end_ms := 0
var phase_total_ms := 1

# 自分の入力（入力フェーズ中のローカル状態。真の値はサーバ）
var my_left_up := false
var my_right_up := false
var my_call := -1
var last_round_id := -1

# 自動プレイ（動作確認用）
var autoplay := ""
var autoplay_started_ms := 0
var guest := false  # --guest：保存済みトークンを使わず別プレイヤーとして入る（同じ PC で 2 つ起動するとき用）
var shot_dir := ""  # --shot=<dir> で各場面のスクリーンショットを保存
var shots_taken := {}

# 画面
var title_screen: Control
var queue_screen: Control
var lobby_screen: Control
var game_screen: Control

# タイトル
var name_edit: LineEdit
var server_edit: LineEdit
var code_edit: LineEdit
var status_label: Label
var profile_label: Label
var cpu_level: OptionButton
var cpu_count: SpinBox

# マッチング待ち
var queue_label: Label

# ロビー
var lobby_code: Label
var lobby_players: VBoxContainer
var lobby_start: Button
var lobby_addcpu: Button
var set_players: SpinBox
var set_input: SpinBox
var set_wins: SpinBox
var set_history: CheckBox
var set_activity: CheckBox

# 対戦
var top_label: Label
var timer_bar: ProgressBar
var timer_label: Label
var phase_label: Label
var players_box: HBoxContainer
var player_views := {}  # id -> {name, hand, info, bubble, bubble_until}
var left_btn: Button
var right_btn: Button
var call_box: HBoxContainer
var call_title: Label
var result_panel: PanelContainer
var result_label: Label
var again_btn: Button
var toast_label: Label
var toast_until := 0


func _ready() -> void:
	theme = _make_theme()
	var bg := ColorRect.new()
	bg.color = Color("1d1f2b")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	if FileAccess.file_exists(SETTINGS_PATH):
		cfg.load(SETTINGS_PATH)
	_build_title()
	_build_queue()
	_build_lobby()
	_build_game()
	toast_label = _label("", 20)
	toast_label.z_index = 10
	toast_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	toast_label.position.y -= 60
	toast_label.add_theme_color_override("font_color", Color("ffb3a1"))
	add_child(toast_label)
	_show(title_screen)

	var server_url: String = cfg.get_value("net", "server", DEFAULT_SERVER)
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--autoplay"):
			autoplay = arg.get_slice("=", 1) if arg.contains("=") else "practice"
			autoplay_started_ms = Time.get_ticks_msec()
		elif arg == "--guest":
			guest = true
		elif arg.begins_with("--shot="):
			shot_dir = arg.get_slice("=", 1)
		elif arg.begins_with("--server="):
			server_url = arg.get_slice("=", 1)
	server_edit.text = server_url

	net = Net.new()
	add_child(net)
	net.message.connect(_on_message)
	net.connected.connect(func(): status_label.text = "接続しました")
	net.disconnected.connect(func(): status_label.text = "サーバとの接続が切れました。再接続中…")
	_connect_server()


func _connect_server() -> void:
	var saved_token: String = cfg.get_value("net", "token", "")
	if autoplay != "" or guest:
		saved_token = ""  # 自動プレイ・ゲストは毎回別プレイヤー扱い
	status_label.text = "接続中… " + server_edit.text
	net.stop()
	net.start(server_edit.text, name_edit.text, saved_token)


## 名前やサーバが変わっていたら繋ぎ直してから送る
func _send_action(msg: Dictionary) -> void:
	if not net.is_active():
		_connect_server()
		_toast("再接続しています。もう一度押してください")
		return
	if net.url != server_edit.text or net.player_name != name_edit.text:
		cfg.set_value("net", "server", server_edit.text)
		cfg.set_value("player", "name", name_edit.text)
		cfg.save(SETTINGS_PATH)
		_connect_server()
		_toast("接続し直しました。もう一度押してください")
		return
	if not net.is_open():
		_toast("サーバに接続できていません")
		return
	net.send(msg)


# ───────── 受信 ─────────

func _on_message(msg: Dictionary) -> void:
	var type := str(msg.get("type", ""))
	match type:
		"welcome":
			my_id = str(msg.get("playerId"))
			if autoplay == "" and not guest:
				cfg.set_value("net", "token", str(msg.get("token")))
				cfg.save(SETTINGS_PATH)
			_update_profile(msg.get("profile", {}))
			if autoplay != "" and state.is_empty():
				_autoplay_begin()
		"profile":
			_update_profile(msg.get("profile", {}))
		"kicked":
			# 自動再接続すると切断し合いになるので止める
			net.stop()
			state = {}
			_show(title_screen)
			status_label.text = str(msg.get("message")) + "（ボタンを押すと再接続）"
		"error":
			_toast(str(msg.get("message")))
			if autoplay != "":
				print("AUTOPLAY_ERROR ", msg.get("message"))
		"queue.status":
			var mode_name: String = MODE_NAMES.get(str(msg.get("mode")), "")
			queue_label.text = "%s マッチング中…\n%d 秒経過（待機 %d 人）" % [mode_name, int(msg.get("waitedSec", 0)), int(msg.get("waiting", 0))]
			_show(queue_screen)
		"queue.left", "room.left":
			state = {}
			_show(title_screen)
			net.send({"type": "profile.get"})
		"round.activity":
			var v = player_views.get(str(msg.get("playerId")))
			if v != null:
				v.hand.twitch()
		"emote":
			_show_emote(str(msg.get("playerId")), int(msg.get("emoteId", 0)))
		_:
			if msg.has("state"):
				_apply_state(type, msg.get("state"))


func _update_profile(p: Dictionary) -> void:
	if p.is_empty():
		return
	profile_label.text = "%s さん ｜ ランク: %s（レート %d）｜ ランク戦 %d 戦 %d 勝" % [
		p.get("name", ""), p.get("tier", ""), int(p.get("rating", 0)), int(p.get("rankedGames", 0)), int(p.get("rankedWins", 0))]


func _apply_state(type: String, s: Dictionary) -> void:
	state = s
	var remaining := int(s.get("phaseRemainingMs", 0))
	phase_end_ms = Time.get_ticks_msec() + remaining
	if type != "input.ack":
		phase_total_ms = maxi(remaining, 1)
	var phase := str(s.get("phase"))
	if phase == "lobby":
		_render_lobby()
		_show(lobby_screen)
		if autoplay == "room":
			_autoplay_lobby()
		return
	_show(game_screen)
	var round_id := int(s.get("roundId", 0))
	if round_id != last_round_id:
		last_round_id = round_id
		my_call = -1
	var you: Dictionary = s.get("you", {})
	if type != "input.ack" or phase != "input":
		var up := int(you.get("thumbs", 0))
		my_left_up = up >= 1
		my_right_up = up >= 2
	if you.get("call") != null:
		my_call = int(you.get("call"))
	_render_game()
	if autoplay != "":
		_autoplay_step(type)


# ───────── 描画 ─────────

func _render_lobby() -> void:
	var is_host := str(state.get("hostId")) == my_id
	lobby_code.text = "ルームコード：%s" % state.get("code", "")
	for c in lobby_players.get_children():
		c.queue_free()
	for p in state.get("players", []):
		var row := HBoxContainer.new()
		var host_mark := "（ホスト）" if str(p.get("id")) == str(state.get("hostId")) else ""
		row.add_child(_label("・%s%s" % [p.get("name"), host_mark], 22))
		if is_host and p.get("isCpu"):
			var pid := str(p.get("id"))
			row.add_child(_button("外す", func(): _send_action({"type": "room.removeCpu", "id": pid})))
		lobby_players.add_child(row)
	var st: Dictionary = state.get("settings", {})
	set_players.set_value_no_signal(float(st.get("maxPlayers", 4)))
	set_input.set_value_no_signal(float(st.get("inputMs", 4000)) / 1000.0)
	set_wins.set_value_no_signal(float(st.get("winsNeeded", 1)))
	set_history.set_pressed_no_signal(bool(st.get("showHistory", true)))
	set_activity.set_pressed_no_signal(bool(st.get("showActivity", true)))
	for sp in [set_players, set_input, set_wins]:
		sp.editable = is_host
	for b in [set_history, set_activity, lobby_addcpu]:
		b.disabled = not is_host
	lobby_start.disabled = not is_host or state.get("players", []).size() < 2
	lobby_start.text = "対戦開始" if is_host else "ホストの開始を待っています…"


func _render_game() -> void:
	var s := state
	var phase := str(s.get("phase"))
	var players: Array = s.get("players", [])
	var caller_id := str(s.get("callerId"))
	var reveal = s.get("lastReveal")
	var me := _player(my_id)

	# 上部バー
	var mode_name: String = MODE_NAMES.get(str(s.get("mode")), "")
	var wins_text := ""
	if int(s.get("settings", {}).get("winsNeeded", 1)) > 1:
		wins_text = " ｜ %d 本先取" % int(s.get("settings", {}).get("winsNeeded", 1))
	top_label.text = "%s ｜ ゲーム %d%s ｜ ラウンド %d%s" % [
		mode_name, int(s.get("gameNo", 1)), wins_text, int(s.get("round", 0)), "  ⚡サドンデス（当てると2本減る）" if s.get("suddenDeath") else ""]

	# プレイヤー表示（メンバーが変わったら作り直す）
	var ids := players.map(func(p): return str(p.get("id")))
	if ids != player_views.keys():
		_rebuild_player_views(players)
	var show_reveal := phase in ["reveal", "gameEnd", "matchEnd"] and reveal is Dictionary
	for p in players:
		var id := str(p.get("id"))
		var v: Dictionary = player_views[id]
		var hands = p.get("hands")
		v.hand.hands = int(hands) if hands != null else 0
		v.hand.highlight = id == caller_id and phase in ["announce", "input", "reveal"]
		if show_reveal and reveal.get("thumbs", {}).has(id):
			v.hand.thumbs_up = int(reveal.get("thumbs")[id])
		elif id == my_id and phase in ["announce", "input"]:
			v.hand.thumbs_up = _my_thumbs()
		else:
			v.hand.thumbs_up = -1
		var tags := []
		if id == my_id:
			tags.append("あなた")
		if p.get("isCpu"):
			tags.append("CPU")
		if not p.get("connected"):
			tags.append("切断中")
		v.name.text = "%s%s" % [p.get("name"), " [%s]" % "/".join(tags) if tags.size() > 0 else ""]
		var info := ""
		if id == caller_id and phase in ["announce", "input"]:
			info += "★コール中  "
		if p.get("placed") != null:
			info += "%d 位  " % int(p.get("placed"))
		info += "勝 %d" % int(p.get("wins", 0))
		var hist: Array = p.get("history", [])
		if hist.size() > 0:
			info += "\n履歴: " + " ".join(hist.map(func(n): return str(int(n))))
		v.info.text = info

	# 中央メッセージ
	var caller_name := _name_of(caller_id)
	match phase:
		"announce":
			phase_label.text = "あなたのコール！" if caller_id == my_id else "%s のコール！" % caller_name
		"input":
			if caller_id == my_id:
				phase_label.text = "数字と指を決めて！（F / J で指、数字キーでコール）"
			else:
				phase_label.text = "%s のコール … 指を決めて！（F / J）" % caller_name
		"reveal":
			phase_label.text = _reveal_text(reveal)
		"gameEnd":
			var gp: Array = s.get("gamePlacements", [])
			phase_label.text = "ゲーム %d 終了：%s の勝ち抜け！" % [int(s.get("gameNo", 1)), _name_of(str(gp[0])) if gp.size() > 0 else "?"]
		"matchEnd":
			phase_label.text = "試合終了"

	# 自分の操作
	var my_hands := int(me.get("hands", 0)) if me.get("hands") != null else 0
	var can_input := phase == "input" and my_hands > 0
	left_btn.visible = my_hands >= 1
	right_btn.visible = my_hands >= 2
	left_btn.disabled = not can_input
	right_btn.disabled = not can_input
	left_btn.text = "左の親指 [F]\n%s" % ("▲ 上げる" if my_left_up else "▽ 下げる")
	right_btn.text = "右の親指 [J]\n%s" % ("▲ 上げる" if my_right_up else "▽ 下げる")
	var i_am_caller := caller_id == my_id and phase in ["announce", "input"]
	call_title.visible = i_am_caller
	call_box.visible = i_am_caller
	if i_am_caller:
		var range_arr: Array = s.get("callRange", [0, 0])
		var max_n := int(range_arr[1])
		if call_box.get_child_count() != max_n + 1:
			for c in call_box.get_children():
				c.queue_free()
			for n in max_n + 1:
				var num := n
				var b := _button(str(n), func(): _choose_call(num))
				b.custom_minimum_size = Vector2(64, 56)
				b.toggle_mode = true
				call_box.add_child(b)
		for c in call_box.get_children():
			var b := c as Button
			var n := int(b.text)
			b.set_pressed_no_signal(n == my_call)
			b.disabled = phase != "input"
			var impossible := n < _my_thumbs() or n > _my_thumbs() + max_n - my_hands
			b.modulate = Color(1, 1, 1, 0.45) if impossible else Color.WHITE
		call_title.text = "コールする数字（%s）" % ("未選択" if my_call < 0 else str(my_call))

	# 結果
	result_panel.visible = phase == "matchEnd"
	if phase == "matchEnd":
		_render_result()


func _reveal_text(reveal) -> String:
	if not reveal is Dictionary:
		return ""
	var caller := _name_of(str(reveal.get("callerId")))
	var total := int(reveal.get("total", 0))
	if reveal.get("call") == null:
		return "%s はコールできず… 合計 %d" % [caller, total]
	var head := "いっせーので、%d！ → 合計 %d" % [int(reveal.get("call")), total]
	if reveal.get("hit"):
		var fin: Array = reveal.get("finished", [])
		return "%s  的中！ %s%s" % [head, caller, " 勝ち抜け！" if fin.size() > 0 else " の手が減った"]
	return "%s  はずれ" % head


func _render_result() -> void:
	var match_info = state.get("match")
	if not match_info is Dictionary:
		return
	var lines := []
	var placements: Array = match_info.get("placements", [])
	for i in placements.size():
		var pid := str(placements[i])
		var p := _player(pid)
		lines.append("%d 位  %s（%d 勝）" % [i + 1, _name_of(pid), int(p.get("wins", 0))])
	if match_info.get("forfeitedBy") != null:
		lines.append("※ %s が棄権しました" % _name_of(str(match_info.get("forfeitedBy"))))
	var extra = match_info.get("extra")
	if extra is Dictionary and extra.get("ratings", {}).has(my_id):
		var r: Dictionary = extra.get("ratings")[my_id]
		lines.append("")
		lines.append("レート %d → %d（%+d）  %s" % [int(r.before), int(r.after), int(r.delta), r.tier])
	result_label.text = "\n".join(lines)
	var mode := str(state.get("mode"))
	again_btn.visible = mode == "practice" or (mode == "private" and str(state.get("hostId")) == my_id)


func _rebuild_player_views(players: Array) -> void:
	for c in players_box.get_children():
		c.queue_free()
	player_views.clear()
	for p in players:
		var panel := PanelContainer.new()
		panel.custom_minimum_size = Vector2(240, 230)
		panel.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var box := _vbox(4)
		panel.add_child(box)
		var bubble := _label("", 20)
		bubble.add_theme_color_override("font_color", Color("ffd166"))
		bubble.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		var name_label := _label("", 20)
		name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		var hand := HandView.new()
		hand.custom_minimum_size = Vector2(220, 120)
		var info := _label("", 16)
		info.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		for c in [bubble, name_label, hand, info]:
			box.add_child(c)
		players_box.add_child(panel)
		player_views[str(p.get("id"))] = {"name": name_label, "hand": hand, "info": info, "bubble": bubble, "bubble_until": 0}


func _show_emote(pid: String, emote_id: int) -> void:
	var v = player_views.get(pid)
	if v == null or emote_id < 0 or emote_id >= EMOTES.size():
		return
	v.bubble.text = "「%s」" % EMOTES[emote_id]
	v.bubble_until = Time.get_ticks_msec() + 2500


# ───────── 入力 ─────────

func _my_thumbs() -> int:
	return int(my_left_up) + int(my_right_up)


func _toggle_thumb(right: bool) -> void:
	if str(state.get("phase")) != "input":
		return
	var hands := int(_player(my_id).get("hands", 0))
	if right:
		if hands < 2:
			return
		my_right_up = not my_right_up
	else:
		if hands < 1:
			return
		my_left_up = not my_left_up
	net.send({"type": "input.thumbs", "roundId": int(state.get("roundId")), "up": _my_thumbs()})
	_render_game()


func _choose_call(n: int) -> void:
	if str(state.get("phase")) != "input" or str(state.get("callerId")) != my_id:
		return
	my_call = n
	net.send({"type": "input.call", "roundId": int(state.get("roundId")), "number": n})
	_render_game()


func _unhandled_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if not game_screen.visible or k == null or not k.pressed or k.echo:
		return
	var key := k.keycode
	if key == KEY_F:
		_toggle_thumb(false)
	elif key == KEY_J:
		_toggle_thumb(true)
	elif key >= KEY_0 and key <= KEY_9:
		_choose_call(key - KEY_0)
	elif key >= KEY_KP_0 and key <= KEY_KP_9:
		_choose_call(key - KEY_KP_0)


func _process(_delta: float) -> void:
	var now := Time.get_ticks_msec()
	if game_screen.visible:
		var left := maxi(0, phase_end_ms - now)
		var phase := str(state.get("phase"))
		timer_bar.visible = phase == "input"
		timer_label.visible = phase == "input"
		timer_bar.value = 100.0 * left / phase_total_ms
		timer_label.text = "%.1f 秒" % (left / 1000.0)
		timer_label.add_theme_color_override("font_color", Color("ff5c5c") if left < 1000 else Color.WHITE)
		for v in player_views.values():
			if v.bubble_until > 0 and now > v.bubble_until:
				v.bubble.text = ""
				v.bubble_until = 0
	if toast_until > 0 and now > toast_until:
		toast_label.text = ""
		toast_until = 0
	if autoplay != "" and now - autoplay_started_ms > 180000:
		print("AUTOPLAY_TIMEOUT")
		get_tree().quit(1)


# ───────── 自動プレイ（動作確認用） ─────────

func _autoplay_begin() -> void:
	print("AUTOPLAY_START ", autoplay, " as ", my_id)
	await _shot("title")
	match autoplay:
		"casual":
			_send_action({"type": "queue.join", "mode": "casual"})
		"ranked":
			_send_action({"type": "queue.join", "mode": "ranked"})
		"room":
			_send_action({"type": "room.create"})
		_:
			cpu_count.value = 1
			_on_practice()


func _autoplay_lobby() -> void:
	if state.get("players", []).size() < 3:
		lobby_addcpu.pressed.emit()
	elif not shots_taken.has("lobby_started"):
		shots_taken["lobby_started"] = true
		await _shot("lobby")
		lobby_start.pressed.emit()


func _autoplay_step(type: String) -> void:
	if type == "round.input" and str(state.get("callerId")) == my_id and not shots_taken.has("input"):
		_toggle_thumb(false)
		_choose_call(2)
		_shot("input")
		return
	if type == "round.reveal" and int(state.get("round", 0)) >= 3:
		_shot("reveal")
	if type == "match.end":
		await _shot("result")
	if type == "round.input":
		if randf() < 0.5:
			_toggle_thumb(false)
		if randf() < 0.5:
			_toggle_thumb(true)
		if str(state.get("callerId")) == my_id:
			var range_arr: Array = state.get("callRange", [0, 0])
			_choose_call(randi_range(0, int(range_arr[1])))
		if randf() < 0.1:
			net.send({"type": "emote", "id": randi_range(0, EMOTES.size() - 1)})
	elif type == "round.reveal":
		print("AUTOPLAY_ROUND ", phase_label.text)
	elif type == "match.end":
		print("AUTOPLAY_RESULT ", result_label.text.replace("\n", " / "))
		get_tree().quit(0)


func _shot(tag: String) -> void:
	if shot_dir == "" or shots_taken.has(tag):
		return
	shots_taken[tag] = true
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var path := "%s/%s.png" % [shot_dir, tag]
	get_viewport().get_texture().get_image().save_png(path)
	print("AUTOPLAY_SHOT ", path)


# ───────── 画面構築 ─────────

func _build_title() -> void:
	title_screen = _screen()
	var box := _vbox(14)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	title_screen.add_child(box)
	var title := _label("YUBISUMA ONLINE", 56)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_color_override("font_color", Color("ff8a5c"))
	box.add_child(title)
	var sub := _label("オンライン指スマ（プロトタイプ）", 22)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(sub)

	var form := GridContainer.new()
	form.columns = 2
	form.add_theme_constant_override("h_separation", 12)
	form.add_theme_constant_override("v_separation", 8)
	form.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	name_edit = LineEdit.new()
	name_edit.text = cfg.get_value("player", "name", "プレイヤー%d" % randi_range(100, 999))
	name_edit.max_length = 16
	name_edit.custom_minimum_size.x = 420
	server_edit = LineEdit.new()
	server_edit.custom_minimum_size.x = 420
	form.add_child(_label("名前"))
	form.add_child(name_edit)
	form.add_child(_label("サーバ"))
	form.add_child(server_edit)
	box.add_child(form)

	var modes := _hbox(12)
	modes.alignment = BoxContainer.ALIGNMENT_CENTER
	modes.add_child(_big_button("ランクマッチ\n1 対 1・BO3", func(): _send_action({"type": "queue.join", "mode": "ranked"})))
	modes.add_child(_big_button("カジュアル\n最大 4 人", func(): _send_action({"type": "queue.join", "mode": "casual"})))
	modes.add_child(_big_button("ルームを作る\nプライベート", func(): _send_action({"type": "room.create"})))
	box.add_child(modes)

	var join := _hbox(8)
	join.alignment = BoxContainer.ALIGNMENT_CENTER
	code_edit = LineEdit.new()
	code_edit.placeholder_text = "ルームコード（6 文字）"
	code_edit.max_length = 6
	code_edit.custom_minimum_size.x = 260
	join.add_child(code_edit)
	join.add_child(_button("ルームに参加", func(): _send_action({"type": "room.join", "code": code_edit.text})))
	box.add_child(join)

	var practice := _hbox(8)
	practice.alignment = BoxContainer.ALIGNMENT_CENTER
	practice.add_child(_label("CPU 練習："))
	cpu_count = SpinBox.new()
	cpu_count.min_value = 1
	cpu_count.max_value = 3
	cpu_count.value = 1
	cpu_count.suffix = "体"
	practice.add_child(cpu_count)
	cpu_level = OptionButton.new()
	cpu_level.add_item("Lv1 ランダム", 1)
	cpu_level.add_item("Lv2 癖を読む", 2)
	cpu_level.select(1)
	practice.add_child(cpu_level)
	practice.add_child(_button("練習する", _on_practice))
	box.add_child(practice)

	profile_label = _label("", 18)
	profile_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(profile_label)
	status_label = _label("", 16)
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label.modulate = Color(1, 1, 1, 0.6)
	box.add_child(status_label)


func _on_practice() -> void:
	_send_action({"type": "practice.start", "cpus": int(cpu_count.value), "level": cpu_level.get_selected_id()})


func _build_queue() -> void:
	queue_screen = _screen()
	var box := _vbox(20)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	queue_screen.add_child(box)
	queue_label = _label("マッチング中…", 32)
	queue_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(queue_label)
	var cancel := _button("キャンセル", func(): _send_action({"type": "queue.leave"}))
	cancel.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	box.add_child(cancel)


func _build_lobby() -> void:
	lobby_screen = _screen()
	var box := _vbox(14)
	lobby_screen.add_child(box)
	lobby_code = _label("", 40)
	lobby_code.add_theme_color_override("font_color", Color("ffd166"))
	box.add_child(lobby_code)
	box.add_child(_label("このコードをフレンドに伝えて参加してもらおう", 18))
	var cols := _hbox(40)
	box.add_child(cols)

	var left := _vbox(8)
	left.custom_minimum_size.x = 460
	left.add_child(_label("メンバー", 24))
	lobby_players = _vbox(6)
	left.add_child(lobby_players)
	lobby_addcpu = _button("CPU を追加（Lv2）", func(): _send_action({"type": "room.addCpu", "level": 2}))
	left.add_child(lobby_addcpu)
	cols.add_child(left)

	var right := GridContainer.new()
	right.columns = 2
	right.add_theme_constant_override("h_separation", 12)
	set_players = _spin(2, 4, 1, "人")
	set_input = _spin(2, 10, 0.5, "秒")
	set_wins = _spin(1, 5, 1, "本先取")
	set_history = CheckBox.new()
	set_history.text = "相手の履歴を表示"
	set_activity = CheckBox.new()
	set_activity.text = "迷いインジケータ（実験）"
	for pair in [["最大人数", set_players], ["入力時間", set_input], ["勝利条件", set_wins], ["", set_history], ["", set_activity]]:
		right.add_child(_label(pair[0]))
		right.add_child(pair[1])
	for sp in [set_players, set_input, set_wins]:
		sp.value_changed.connect(func(_v): _push_settings())
	set_history.toggled.connect(func(_v): _push_settings())
	set_activity.toggled.connect(func(_v): _push_settings())
	cols.add_child(right)

	var buttons := _hbox(12)
	lobby_start = _button("対戦開始", func(): _send_action({"type": "room.start"}))
	buttons.add_child(lobby_start)
	buttons.add_child(_button("ルームを出る", func(): _send_action({"type": "room.leave"})))
	box.add_child(buttons)


func _push_settings() -> void:
	_send_action({"type": "room.settings", "settings": {
		"maxPlayers": int(set_players.value),
		"inputMs": int(set_input.value * 1000),
		"winsNeeded": int(set_wins.value),
		"showHistory": set_history.button_pressed,
		"showActivity": set_activity.button_pressed,
	}})


func _build_game() -> void:
	game_screen = _screen()
	var box := _vbox(10)
	game_screen.add_child(box)

	var top := _hbox(16)
	top_label = _label("", 18)
	top_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(top_label)
	top.add_child(_button("退出", func(): _send_action({"type": "room.leave"})))
	box.add_child(top)

	var timer_row := _hbox(12)
	timer_bar = ProgressBar.new()
	timer_bar.show_percentage = false
	timer_bar.custom_minimum_size.y = 18
	timer_bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	timer_bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	timer_row.add_child(timer_bar)
	timer_label = _label("", 24)
	timer_label.custom_minimum_size.x = 100
	timer_row.add_child(timer_label)
	box.add_child(timer_row)

	phase_label = _label("", 30)
	phase_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	phase_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(phase_label)

	players_box = _hbox(16)
	players_box.alignment = BoxContainer.ALIGNMENT_CENTER
	players_box.size_flags_vertical = Control.SIZE_EXPAND_FILL
	box.add_child(players_box)

	var controls := _hbox(24)
	controls.alignment = BoxContainer.ALIGNMENT_CENTER
	left_btn = _button("", func(): _toggle_thumb(false))
	right_btn = _button("", func(): _toggle_thumb(true))
	for b in [left_btn, right_btn]:
		b.custom_minimum_size = Vector2(180, 80)
		b.focus_mode = Control.FOCUS_NONE
		controls.add_child(b)
	var call_col := _vbox(4)
	call_title = _label("", 18)
	call_col.add_child(call_title)
	call_box = _hbox(6)
	call_col.add_child(call_box)
	controls.add_child(call_col)
	box.add_child(controls)

	var emotes := _hbox(6)
	emotes.alignment = BoxContainer.ALIGNMENT_CENTER
	for i in EMOTES.size():
		var idx := i
		var b := _button(EMOTES[i], func(): net.send({"type": "emote", "id": idx}))
		b.add_theme_font_size_override("font_size", 15)
		b.focus_mode = Control.FOCUS_NONE
		emotes.add_child(b)
	box.add_child(emotes)

	var fill := StyleBoxFlat.new()
	fill.bg_color = Color("ff8a5c")
	fill.set_corner_radius_all(6)
	timer_bar.add_theme_stylebox_override("fill", fill)

	# 試合結果（画面全体を暗くして中央に表示）
	result_panel = PanelContainer.new()
	var dim := StyleBoxFlat.new()
	dim.bg_color = Color(0, 0, 0, 0.6)
	result_panel.add_theme_stylebox_override("panel", dim)
	result_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	var center := CenterContainer.new()
	result_panel.add_child(center)
	var card := PanelContainer.new()
	var card_style := StyleBoxFlat.new()
	card_style.bg_color = Color("2a2d3e")
	card_style.set_corner_radius_all(16)
	card_style.set_content_margin_all(32)
	card.add_theme_stylebox_override("panel", card_style)
	card.custom_minimum_size = Vector2(560, 0)
	center.add_child(card)
	var rbox := _vbox(14)
	card.add_child(rbox)
	var rtitle := _label("試合結果", 34)
	rtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rbox.add_child(rtitle)
	result_label = _label("", 22)
	rbox.add_child(result_label)
	var rbuttons := _hbox(12)
	rbuttons.alignment = BoxContainer.ALIGNMENT_CENTER
	again_btn = _button("もう一度", func(): _send_action({"type": "room.start"}))
	rbuttons.add_child(again_btn)
	rbuttons.add_child(_button("メニューへ", func(): _send_action({"type": "room.leave"})))
	rbox.add_child(rbuttons)
	result_panel.visible = false
	# MarginContainer の外（ルート直下）に置いて全画面を覆う
	add_child(result_panel)


# ───────── ヘルパ ─────────

func _make_theme() -> Theme:
	var t := Theme.new()
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["Yu Gothic UI", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", "Noto Sans JP", "IPAGothic", "sans-serif"])
	t.default_font = font
	t.default_font_size = 20
	return t


func _screen() -> Control:
	var m := MarginContainer.new()
	m.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		m.add_theme_constant_override("margin_" + side, 32)
	m.visible = false
	add_child(m)
	return m


func _show(screen: Control) -> void:
	for s in [title_screen, queue_screen, lobby_screen, game_screen]:
		s.visible = s == screen
	if screen != game_screen:
		result_panel.visible = false


func _label(text: String, font_size := 20) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", font_size)
	return l


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b


func _big_button(text: String, cb: Callable) -> Button:
	var b := _button(text, cb)
	b.custom_minimum_size = Vector2(240, 96)
	b.add_theme_font_size_override("font_size", 24)
	return b


func _spin(min_v: float, max_v: float, step: float, suffix: String) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = min_v
	s.max_value = max_v
	s.step = step
	s.suffix = suffix
	return s


func _vbox(sep: int) -> VBoxContainer:
	var b := VBoxContainer.new()
	b.add_theme_constant_override("separation", sep)
	return b


func _hbox(sep: int) -> HBoxContainer:
	var b := HBoxContainer.new()
	b.add_theme_constant_override("separation", sep)
	return b


func _player(id: String) -> Dictionary:
	for p in state.get("players", []):
		if str(p.get("id")) == id:
			return p
	return {}


func _name_of(id: String) -> String:
	return str(_player(id).get("name", "?"))


func _toast(text: String) -> void:
	toast_label.text = text
	toast_until = Time.get_ticks_msec() + 3000
