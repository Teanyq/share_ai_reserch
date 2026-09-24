## 教室の床（上から見た木の床）と、まわりに並ぶほかの机・椅子を描く背景。
class_name ClassroomView
extends Control

const PLANK_A := Color("c99a63")
const PLANK_B := Color("c08f59")
const SEAM := Color("a47243")


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	resized.connect(queue_redraw)


func _draw() -> void:
	var w := size.x
	var h := size.y
	# 床板：縦に並んだ板、継ぎ目は板ごとにずらす
	var pw := 88.0
	var i := 0
	var x := 0.0
	while x < w:
		draw_rect(Rect2(x, 0, pw, h), PLANK_A if i % 2 == 0 else PLANK_B)
		for g in 4:
			var gx := x + 12 + g * 20 + (i * 7) % 9
			draw_line(Vector2(gx, 0), Vector2(gx + 3, h), Color(0, 0, 0, 0.035), 1.0)
		draw_line(Vector2(x, 0), Vector2(x, h), SEAM, 2.0)
		var y := fmod(i * 137.0, 260.0)
		while y < h:
			draw_line(Vector2(x, y), Vector2(x + pw, y), SEAM, 2.0)
			y += 260.0
		x += pw
		i += 1

	# 画面の四隅にほかの班の机と椅子（半分見切れている）
	var desk := Vector2(170, 118)
	for p in [Vector2(-70, h - 120), Vector2(w - 100, h - 130), Vector2(-80, 150), Vector2(w - 90, 170)]:
		_desk(Rect2(p, desk))
		_chair(Rect2(p + Vector2(desk.x / 2 - 40, desk.y + 6), Vector2(80, 44)))

	# 四辺をほんのり暗くして中央に目線を集める
	for k in 6:
		var a := 0.05 * (6 - k) / 6.0
		var m := k * 14.0
		draw_rect(Rect2(m, m, w - m * 2, h - m * 2), Color(0.15, 0.08, 0.02, a), false, 14.0)


func _desk(r: Rect2) -> void:
	draw_rect(Rect2(r.position + Vector2(4, 6), r.size), Color(0, 0, 0, 0.15))
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color("dcb888")
	sb.border_color = Color("8f6237")
	sb.set_border_width_all(3)
	sb.set_corner_radius_all(6)
	draw_style_box(sb, r)


func _chair(r: Rect2) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color("b98a57")
	sb.border_color = Color("6e6e76")
	sb.set_border_width_all(3)
	sb.set_corner_radius_all(8)
	draw_style_box(sb, r)
