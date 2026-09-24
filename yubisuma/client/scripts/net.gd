## サーバとの WebSocket 通信。切断時は自動で再接続し、hello を送り直す。
class_name Net
extends Node

signal message(msg: Dictionary)
signal connected
signal disconnected

const RECONNECT_SEC := 2.0

var url := ""
var player_name := ""
var token := ""

var _ws := WebSocketPeer.new()
var _was_open := false
var _retry_in := 0.0
var _active := false


func start(server_url: String, name: String, saved_token: String) -> void:
	url = server_url
	player_name = name
	token = saved_token
	_active = true
	_open()


func stop() -> void:
	_active = false
	_was_open = false
	_ws.close()


func is_active() -> bool:
	return _active


func is_open() -> bool:
	return _ws.get_ready_state() == WebSocketPeer.STATE_OPEN


func send(msg: Dictionary) -> void:
	if is_open():
		_ws.send_text(JSON.stringify(msg))


func _open() -> void:
	_ws = WebSocketPeer.new()
	var err := _ws.connect_to_url(url)
	if err != OK:
		push_warning("connect failed: %s" % err)
		_retry_in = RECONNECT_SEC


func _process(delta: float) -> void:
	if not _active:
		return
	_ws.poll()
	var state := _ws.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if not _was_open:
			_was_open = true
			send({"type": "hello", "name": player_name, "token": token})
			connected.emit()
		while _ws.get_available_packet_count() > 0:
			var text := _ws.get_packet().get_string_from_utf8()
			var parsed = JSON.parse_string(text)
			if parsed is Dictionary:
				if parsed.get("type") == "welcome":
					token = str(parsed.get("token", ""))
				message.emit(parsed)
	elif state == WebSocketPeer.STATE_CLOSED:
		if _was_open:
			_was_open = false
			disconnected.emit()
			_retry_in = RECONNECT_SEC
		_retry_in -= delta
		if _retry_in <= 0.0:
			_retry_in = RECONNECT_SEC
			_open()
