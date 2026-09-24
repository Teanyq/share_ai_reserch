## プレイヤーの手（握りこぶし + 親指）を描く。画像素材なしのプロトタイプ用。
class_name HandView
extends Control

const SKIN := Color("ffe0c2")
const SKIN_DARK := Color("e0b48c")
const OUTLINE := Color("5a3a22")

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
var highlight := false:
	set(v):
		highlight = v
		queue_redraw()

var _twitch := 0.0


func _ready() -> void:
	custom_minimum_size = Vector2(170, 120)


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
	if highlight:
		draw_rect(Rect2(Vector2.ZERO, size), Color(1, 0.85, 0.2, 0.18))
	if hands <= 0:
		_draw_centered_text("抜け！", Vector2(w / 2, h / 2), 24, Color("7bd88f"))
		return
	var fist := Vector2(62, 48)
	var gap := 18.0
	var total_w := fist.x * hands + gap * (hands - 1)
	var x0 := (w - total_w) / 2
	var y0 := h - fist.y - 10
	var shake := sin(_twitch * 40.0) * 4.0 * _twitch
	for i in hands:
		var up := thumbs_up >= 0 and i < thumbs_up
		_draw_fist(Vector2(x0 + i * (fist.x + gap) + shake, y0), fist, up, i == 0 and hands == 2)
	if thumbs_up < 0:
		_draw_centered_text("?", Vector2(w / 2, 22), 22, Color(1, 1, 1, 0.6))


func _draw_fist(pos: Vector2, fist: Vector2, thumb_up: bool, inner_right: bool) -> void:
	var body := Rect2(pos, fist)
	_draw_round_rect(body, 16.0, SKIN)
	# 指の関節の線
	for k in range(1, 4):
		var x := pos.x + fist.x * k / 4.0
		draw_line(Vector2(x, pos.y + fist.y - 20), Vector2(x, pos.y + fist.y - 6), SKIN_DARK, 2.0)
	# 親指はこぶしの内側（左手なら右端、右手なら左端）に付いている
	var thumb := Vector2(24, 44)
	var tx := pos.x + fist.x - thumb.x - 4 if inner_right else pos.x + 4
	if thumb_up:
		var r := Rect2(tx, pos.y - thumb.y + 14, thumb.x, thumb.y)
		_draw_round_rect(r, 11.0, SKIN)
		# 爪
		_draw_round_rect(Rect2(r.position.x + 5, r.position.y + 4, thumb.x - 10, 12), 5.0, Color("fff3e6"))
	else:
		# 下げた親指はこぶしの上に横たわる
		var lx := pos.x + 6
		_draw_round_rect(Rect2(lx, pos.y + 6, fist.x - 12, 16), 8.0, SKIN_DARK)


func _draw_round_rect(r: Rect2, radius: float, color: Color) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(int(radius))
	sb.border_color = OUTLINE
	sb.set_border_width_all(2)
	draw_style_box(sb, r)


func _draw_centered_text(text: String, center: Vector2, font_size: int, color: Color) -> void:
	var font := get_theme_default_font()
	var ts := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	draw_string(font, center + Vector2(-ts.x / 2, ts.y / 4), text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color)
