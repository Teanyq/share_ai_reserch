## 班の形にくっつけた 4 つの机（上から見た図）と、それを囲むプレイヤーの席。
## 自分は常に手前（下）。ほかの人は時計回りに 左・奥・右 に座る。
## 各席に 手（HandView）・名札・ふせん（履歴）・吹き出し（エモート）を置く。
class_name TableView
extends Control

const HAND_SIZE := Vector2(240, 150)
const SLEEVES := {"B": Color("4f86d9"), "L": Color("47a866"), "T": Color("dd5a52"), "R": Color("e0952f")}
const ROTATIONS := {"B": 0.0, "L": PI / 2, "T": PI, "R": -PI / 2}
const SIDE_ORDER := {1: ["B"], 2: ["B", "T"], 3: ["B", "L", "R"], 4: ["B", "L", "T", "R"]}
const INK := Color("3b2a1a")
const WOOD := Color("e7c793")
const WOOD_EDGE := Color("9a6a3a")
const GRAIN := Color("d6b27c")

## id -> {side, hand, tag, note, bubble, bubble_until}
var seats := {}
## コール中のプレイヤー（光らせる）。空なら誰も光らせない
var caller_id := "":
	set(v):
		caller_id = v
		queue_redraw()
## 机の真ん中に置く紙に書く文字
var center_big := ""
var center_small := ""

var island := Rect2()


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	resized.connect(refresh)


## 席を作り直す（メンバーが変わったとき）
func setup(ids: Array, my_id: String) -> void:
	for s in seats.values():
		for k in ["hand", "tag", "note", "bubble"]:
			s[k].queue_free()
	seats.clear()
	var n := ids.size()
	var start := maxi(0, ids.find(my_id))
	var sides: Array = SIDE_ORDER.get(n, ["B", "L", "T", "R"])
	var hands := []
	var labels := []
	for i in n:
		var id := str(ids[(start + i) % n])
		var side: String = sides[mini(i, sides.size() - 1)]
		var hand := HandView.new()
		hand.size = HAND_SIZE
		hand.pivot_offset = HAND_SIZE / 2
		hand.rotation = ROTATIONS[side]
		hand.sleeve = SLEEVES[side]
		var tag := _make_label(17, Color.WHITE, SLEEVES[side], 3)
		var note := _make_label(14, Color("fff27e"), Color(0, 0, 0, 0), 0)
		var bubble := _make_label(16, Color.WHITE, INK, 2)
		(bubble.get_theme_stylebox("normal") as StyleBoxFlat).set_corner_radius_all(16)
		note.visible = false
		bubble.visible = false
		hands.append(hand)
		labels.append_array([tag, note, bubble])
		seats[id] = {"side": side, "hand": hand, "tag": tag, "note": note, "bubble": bubble, "bubble_until": 0}
	# 手 → 名札などの順に重ねる
	for c in hands + labels:
		add_child(c)
	refresh()


func set_tag(id: String, text: String, is_caller: bool) -> void:
	var s = seats.get(id)
	if s == null:
		return
	s.tag.text = text
	var sb := s.tag.get_theme_stylebox("normal") as StyleBoxFlat
	sb.bg_color = Color("fff1a8") if is_caller else Color.WHITE


func set_note(id: String, text: String) -> void:
	var s = seats.get(id)
	if s != null:
		s.note.text = text
		s.note.visible = text != ""


func show_bubble(id: String, text: String) -> void:
	var s = seats.get(id)
	if s == null:
		return
	s.bubble.text = text
	s.bubble.visible = true
	s.bubble_until = Time.get_ticks_msec() + 2500
	refresh()


func _process(_delta: float) -> void:
	var now := Time.get_ticks_msec()
	for s in seats.values():
		if s.bubble_until > 0 and now > s.bubble_until:
			s.bubble.visible = false
			s.bubble_until = 0


## 文字が変わったあとに呼ぶ（名札の大きさに合わせて並べ直す）
func refresh() -> void:
	var iw := minf(620.0, size.x - 360.0)
	var ih := minf(280.0, size.y - 40.0)
	island = Rect2(Vector2((size.x - iw) / 2, (size.y - ih) / 2), Vector2(iw, ih))
	var c := island.get_center()
	for id in seats:
		var s: Dictionary = seats[id]
		var side: String = s.side
		s.hand.position = _hand_center(side) - HAND_SIZE / 2
		var tag: Label = s.tag
		tag.size = tag.get_combined_minimum_size()
		var ts := tag.size
		match side:
			"B":
				tag.position = Vector2(c.x + 138, island.end.y - ts.y * 0.35)
			"T":
				tag.position = Vector2(c.x + 138, island.position.y - ts.y * 0.65)
			"L":
				tag.position = Vector2(island.position.x - ts.x - 20, c.y - ts.y - 40)
			"R":
				tag.position = Vector2(island.end.x + 20, c.y - ts.y - 40)
		var note: Label = s.note
		note.size = note.get_combined_minimum_size()
		if side == "B" or side == "T":
			note.position = Vector2(tag.position.x + ts.x + 8, tag.position.y + (ts.y - note.size.y) / 2)
		else:
			note.position = Vector2(tag.position.x + (ts.x - note.size.x) / 2, tag.position.y + ts.y + 8)
		var bubble: Label = s.bubble
		bubble.size = bubble.get_combined_minimum_size()
		var bs := bubble.size
		match side:
			"B":
				bubble.position = Vector2(c.x - 140 - bs.x, island.end.y - bs.y - 14)
			"T":
				bubble.position = Vector2(c.x - 140 - bs.x, island.position.y + 14)
			_:
				bubble.position = Vector2(tag.position.x + (ts.x - bs.x) / 2, tag.position.y - bs.y - 8)
	queue_redraw()


func _hand_center(side: String) -> Vector2:
	var c := island.get_center()
	match side:
		"T":
			return Vector2(c.x, island.position.y + 45)
		"L":
			return Vector2(island.position.x + 45, c.y)
		"R":
			return Vector2(island.end.x - 45, c.y)
	return Vector2(c.x, island.end.y - 45)


func _make_label(font_size: int, bg: Color, border: Color, border_w: int) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", font_size)
	l.add_theme_color_override("font_color", INK)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(border_w)
	sb.set_corner_radius_all(6)
	sb.content_margin_left = 10
	sb.content_margin_right = 10
	sb.content_margin_top = 4
	sb.content_margin_bottom = 4
	sb.shadow_color = Color(0, 0, 0, 0.22)
	sb.shadow_size = 2
	sb.shadow_offset = Vector2(1, 3)
	l.add_theme_stylebox_override("normal", sb)
	return l


# ───────── 描画 ─────────

func _draw() -> void:
	if seats.is_empty():
		return
	var c := island.get_center()
	# 椅子（座っている辺だけ）
	for s in seats.values():
		_draw_chair(s.side)

	# 机の影
	draw_rect(Rect2(island.position + Vector2(6, 10), island.size), Color(0, 0, 0, 0.22))
	# 2×2 の机（少しすき間がある）
	var gap := 5.0
	var dw := (island.size.x - gap) / 2
	var dh := (island.size.y - gap) / 2
	for row in 2:
		for col in 2:
			var r := Rect2(island.position + Vector2(col * (dw + gap), row * (dh + gap)), Vector2(dw, dh))
			_draw_desk(r, row == 0)

	# 小物（鉛筆・消しゴム・ノート）を机の外側の角に置く
	var p := island.position
	var e := island.end
	_draw_pencil(Vector2(p.x + 22, p.y + 22), 0.12)
	_draw_eraser(Vector2(e.x - 150, p.y + 26))
	_draw_notebook(Rect2(e.x - 100, p.y + 16, 72, 88), Color("7fb2e5"))
	_draw_pencil(Vector2(p.x + 30, e.y - 34), -0.08)
	_draw_eraser(Vector2(p.x + 34, e.y - 70))

	# コール中の人の手元を光らせる
	if caller_id != "" and seats.has(caller_id):
		var side: String = seats[caller_id].side
		var hc := _hand_center(side)
		var hs := HAND_SIZE if side == "B" or side == "T" else Vector2(HAND_SIZE.y, HAND_SIZE.x)
		var glow := StyleBoxFlat.new()
		glow.bg_color = Color(1, 0.92, 0.35, 0.42)
		glow.set_corner_radius_all(40)
		draw_style_box(glow, Rect2(hc - hs / 2 - Vector2(6, 6), hs + Vector2(12, 12)))

	# 真ん中の紙（コールした数字など）
	if center_big != "":
		draw_set_transform(c, -0.05, Vector2.ONE)
		var paper := Rect2(Vector2(-78, -46), Vector2(156, 92))
		draw_rect(Rect2(paper.position + Vector2(3, 4), paper.size), Color(0, 0, 0, 0.2))
		draw_rect(paper, Color("fffdf6"))
		for k in range(1, 4):
			draw_line(Vector2(-72, -46 + k * 23), Vector2(72, -46 + k * 23), Color("c9ddf0"), 1.0)
		draw_line(Vector2(-58, -46), Vector2(-58, 46), Color("f2a7a7"), 1.0)
		var font := get_theme_default_font()
		_text(font, center_small, Vector2(0, -26), 15, Color("5a6b8a"))
		_text(font, center_big, Vector2(0, 22), 44, Color("d9443a"))
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _text(font: Font, text: String, center: Vector2, font_size: int, color: Color) -> void:
	var ts := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	draw_string(font, center + Vector2(-ts.x / 2, ts.y * 0.3), text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color)


func _draw_desk(r: Rect2, top_row: bool) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = WOOD
	sb.border_color = WOOD_EDGE
	sb.set_border_width_all(3)
	sb.set_corner_radius_all(5)
	draw_style_box(sb, r)
	# 木目
	for k in 6:
		var y := r.position.y + 14 + k * (r.size.y - 28) / 5.0
		var wobble := sin(k * 1.7 + r.position.x * 0.01) * 6.0
		draw_line(Vector2(r.position.x + 12, y + wobble), Vector2(r.end.x - 12, y - wobble), GRAIN, 2.0)
	# 鉛筆を置く溝（座る側の辺）
	var gy := r.position.y + 10 if top_row else r.end.y - 18
	var groove := StyleBoxFlat.new()
	groove.bg_color = Color("c9a46e")
	groove.set_corner_radius_all(4)
	draw_style_box(groove, Rect2(r.position.x + r.size.x * 0.2, gy, r.size.x * 0.6, 8))


func _draw_chair(side: String) -> void:
	var c := island.get_center()
	var r: Rect2
	match side:
		"B":
			r = Rect2(c.x - 70, island.end.y + 8, 140, 56)
		"T":
			r = Rect2(c.x - 70, island.position.y - 64, 140, 56)
		"L":
			r = Rect2(island.position.x - 64, c.y - 70, 56, 140)
		_:
			r = Rect2(island.end.x + 8, c.y - 70, 56, 140)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color("c29462")
	sb.border_color = Color("707078")
	sb.set_border_width_all(4)
	sb.set_corner_radius_all(10)
	draw_rect(Rect2(r.position + Vector2(3, 5), r.size), Color(0, 0, 0, 0.18))
	draw_style_box(sb, r)


func _draw_pencil(pos: Vector2, angle: float) -> void:
	draw_set_transform(pos, angle, Vector2.ONE)
	draw_rect(Rect2(0, 0, 70, 10), Color("f4c430"))
	draw_rect(Rect2(0, 3, 70, 2), Color("e0ab12"))
	draw_rect(Rect2(-12, 0, 12, 10), Color("f39aa6"))
	draw_rect(Rect2(-4, 0, 4, 10), Color("c0c0c8"))
	draw_colored_polygon(PackedVector2Array([Vector2(70, 0), Vector2(84, 5), Vector2(70, 10)]), Color("f3d9b1"))
	draw_colored_polygon(PackedVector2Array([Vector2(79, 3), Vector2(84, 5), Vector2(79, 7)]), Color("444444"))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _draw_eraser(pos: Vector2) -> void:
	draw_rect(Rect2(pos + Vector2(2, 3), Vector2(40, 20)), Color(0, 0, 0, 0.15))
	draw_rect(Rect2(pos, Vector2(40, 20)), Color("fbfbf8"))
	draw_rect(Rect2(pos + Vector2(10, 0), Vector2(24, 20)), Color("3d7cc9"))
	draw_rect(Rect2(pos, Vector2(40, 20)), Color("9aa0a8"), false, 1.0)


func _draw_notebook(r: Rect2, cover: Color) -> void:
	draw_rect(Rect2(r.position + Vector2(3, 4), r.size), Color(0, 0, 0, 0.18))
	draw_rect(r, cover)
	draw_rect(Rect2(r.position + Vector2(12, 14), Vector2(r.size.x - 24, 22)), Color("fffdf2"))
	draw_line(Vector2(r.position.x + 16, r.position.y + 29), Vector2(r.end.x - 16, r.position.y + 29), Color("9aa8b8"), 1.0)
	draw_rect(Rect2(r.position, Vector2(6, r.size.y)), cover.darkened(0.25))
