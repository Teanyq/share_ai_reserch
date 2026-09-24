## プレイヤーの手（袖・握りこぶし・親指）を描く。画像素材なしのプロトタイプ用。
## 手前（下）から腕が伸びてくる向きで描くので、席に合わせて Control ごと回転させて使う。
class_name HandView
extends Control

const SKIN := Color("ffdcb8")
const SKIN_SHADE := Color("f0bf94")
const OUTLINE := Color("6b4226")

## 残っている手の数（0〜2）
var hands := 2:
	set(v):
		hands = v
		queue_redraw()
## 上げている親指の数。-1 は「まだ見えない」
var thumbs_up := -1:
	set(v):
		thumbs_up = v
		queue_redraw()
## 袖（服）の色。席ごとに変えて誰の手か分かりやすくする
var sleeve := Color("5b8bd6"):
	set(v):
		sleeve = v
		queue_redraw()

var _twitch := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


## 相手が入力を変えた瞬間の「ピクッ」演出（値は分からない）
func twitch() -> void:
	_twitch = 1.0


func _process(delta: float) -> void:
	if _twitch > 0.0:
		_twitch = maxf(0.0, _twitch - delta * 5.0)
		queue_redraw()


func _draw() -> void:
	var w := size.x
	var h := size.y
	if hands <= 0:
		_draw_centered_text("ぬけ！", Vector2(w / 2, h / 2), 30, Color("e0463c"))
		return
	var fist := Vector2(66, 50)
	var gap := 26.0
	var total_w := fist.x * hands + gap * (hands - 1)
	var x0 := (w - total_w) / 2
	var y0 := h - fist.y - 44
	var shake := sin(_twitch * 40.0) * 4.0 * _twitch
	for i in hands:
		var up := thumbs_up >= 0 and i < thumbs_up
		var pos := Vector2(x0 + i * (fist.x + gap) + shake, y0)
		_draw_arm(pos, fist, h)
		_draw_fist(pos, fist, up, i == 0 and hands == 2)
	if thumbs_up < 0:
		_draw_centered_text("？", Vector2(w / 2, 14), 22, Color(0.3, 0.2, 0.1, 0.55))


func _draw_arm(pos: Vector2, fist: Vector2, h: float) -> void:
	# 手首
	draw_rect(Rect2(pos.x + 14, pos.y + fist.y - 6, fist.x - 28, 16), SKIN_SHADE)
	# 袖
	var sb := StyleBoxFlat.new()
	sb.bg_color = sleeve
	sb.border_color = sleeve.darkened(0.35)
	sb.set_border_width_all(2)
	sb.corner_radius_top_left = 8
	sb.corner_radius_top_right = 8
	draw_style_box(sb, Rect2(pos.x + 4, pos.y + fist.y + 8, fist.x - 8, h - (pos.y + fist.y + 8) + 4))
	draw_line(Vector2(pos.x + 6, pos.y + fist.y + 16), Vector2(pos.x + fist.x - 6, pos.y + fist.y + 16), sleeve.lightened(0.3), 2.0)


func _draw_fist(pos: Vector2, fist: Vector2, thumb_up: bool, inner_right: bool) -> void:
	# 影
	_draw_round_rect(Rect2(pos + Vector2(3, 5), fist), 18.0, Color(0, 0, 0, 0.18), false)
	_draw_round_rect(Rect2(pos, fist), 18.0, SKIN)
	# 指の関節
	for k in range(1, 4):
		var x := pos.x + fist.x * k / 4.0
		draw_line(Vector2(x, pos.y + fist.y - 22), Vector2(x, pos.y + fist.y - 8), SKIN_SHADE.darkened(0.1), 2.0)
	# 親指はこぶしの内側（左手なら右端、右手なら左端）
	var thumb := Vector2(24, 46)
	var tx := pos.x + fist.x - thumb.x - 4 if inner_right else pos.x + 4
	if thumb_up:
		var r := Rect2(tx, pos.y - thumb.y + 16, thumb.x, thumb.y)
		_draw_round_rect(r, 11.0, SKIN)
		_draw_round_rect(Rect2(r.position.x + 5, r.position.y + 4, thumb.x - 10, 12), 5.0, Color("fff1e4"))
	else:
		# 下げた親指はこぶしの上に横たわる
		_draw_round_rect(Rect2(pos.x + 7, pos.y + 6, fist.x - 14, 17), 8.0, SKIN_SHADE)


func _draw_round_rect(r: Rect2, radius: float, color: Color, outline := true) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(int(radius))
	if outline:
		sb.border_color = OUTLINE
		sb.set_border_width_all(2)
	draw_style_box(sb, r)


func _draw_centered_text(text: String, center: Vector2, font_size: int, color: Color) -> void:
	var font := get_theme_default_font()
	var ts := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	draw_string(font, center + Vector2(-ts.x / 2, ts.y / 4), text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color)
