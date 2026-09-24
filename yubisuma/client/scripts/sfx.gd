## 超簡素な効果音。音声ファイルを使わず、起動時に矩形波・サイン波で合成する。
class_name Sfx
extends Node

const RATE := 22050

var enabled := true

var _streams := {}
var _players: Array[AudioStreamPlayer] = []
var _next := 0


func _ready() -> void:
	for i in 6:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)
	# [周波数(Hz, 0 は無音), 長さ(秒)] の並び
	_streams = {
		"click": _make([[900.0, 0.03]], 0.22, true),
		"call": _make([[1300.0, 0.04]], 0.22, true),
		"ready": _make([[660.0, 0.05], [990.0, 0.08]], 0.35, false),
		"announce": _make([[784.0, 0.1], [1047.0, 0.14]], 0.3, false),
		"tick": _make([[1500.0, 0.025]], 0.18, true),
		"reveal": _make([[523.0, 0.05], [0.0, 0.03], [523.0, 0.05], [0.0, 0.03], [784.0, 0.16]], 0.28, true),
		"hit": _make([[523.0, 0.07], [659.0, 0.07], [784.0, 0.07], [1047.0, 0.2]], 0.26, true),
		"miss": _make([[330.0, 0.12], [247.0, 0.22]], 0.26, true),
		"win": _make([[523.0, 0.1], [659.0, 0.1], [784.0, 0.1], [1047.0, 0.14], [784.0, 0.08], [1047.0, 0.32]], 0.26, true),
		"emote": _make([[1200.0, 0.03], [1600.0, 0.04]], 0.2, false),
	}


func play(sound: String) -> void:
	if not enabled or not _streams.has(sound):
		return
	var p := _players[_next]
	_next = (_next + 1) % _players.size()
	p.stream = _streams[sound]
	p.play()


func play_later(sound: String, sec: float) -> void:
	get_tree().create_timer(sec).timeout.connect(func(): play(sound))


func _make(notes: Array, volume: float, square: bool) -> AudioStreamWAV:
	var data := PackedByteArray()
	for n in notes:
		var freq: float = n[0]
		var count := int(float(n[1]) * RATE)
		for i in count:
			var v := 0.0
			if freq > 0.0:
				var phase := fmod(float(i) * freq / RATE, 1.0)
				if square:
					v = 0.5 if phase < 0.5 else -0.5
				else:
					v = sin(TAU * phase)
			# 立ち上がり 5ms・あとは直線で減衰（プツッという音を防ぐ）
			var env := minf(1.0, i / (RATE * 0.005)) * (1.0 - float(i) / count)
			var s := int(clampf(v * env * volume, -1.0, 1.0) * 32767.0)
			data.append(s & 0xFF)
			data.append((s >> 8) & 0xFF)
	var st := AudioStreamWAV.new()
	st.format = AudioStreamWAV.FORMAT_16_BITS
	st.mix_rate = RATE
	st.stereo = false
	st.data = data
	return st
