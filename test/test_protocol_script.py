"""Unit tests for scripts/test_protocols.py using an isolated local fake gateway."""
import io
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import test_protocols as p  # noqa: E402

FAKE_KEY = "sk-not-a-real-secret-123456789"
MODEL = "deepseek-flash"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("content-length", "0")))
        value = json.loads(raw)
        assert self.path in p.PATHS.values()
        if self.path == "/v1/messages":
            assert self.headers.get("anthropic-version") == "2023-06-01"
            assert self.headers.get("x-api-key") == FAKE_KEY
            assert self.headers.get("authorization") is None
        else:
            assert self.headers.get("authorization") == "Bearer " + FAKE_KEY
        protocol = next(k for k, v in p.PATHS.items() if v == self.path)
        if value["model"] == "raise-503":
            body = json.dumps({"error": {"message": "No available channel (for sk-not-a-real-secret-123456789)"}}).encode()
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if value.get("stream"):
            if protocol == "chat":
                lines = [
                    'data: {"object":"chat.completion.chunk","model":"upstream-chat","choices":[{"delta":{"content":"OK"},"index":0}]}',
                    "",
                    "data: [DONE]",
                    "",
                ]
            elif protocol == "anthropic":
                lines = [
                    "event: message_start",
                    'data: {"type":"message_start","message":{"model":"upstream-anthropic"}}',
                    "",
                    "event: content_block_delta",
                    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}',
                    "",
                    "event: message_stop",
                    'data: {"type":"message_stop"}',
                    "",
                ]
            else:
                lines = [
                    "event: response.created",
                    'data: {"type":"response.created","response":{"model":"upstream-responses"}}',
                    "",
                    "event: response.completed",
                    'data: {"type":"response.completed","response":{"model":"upstream-responses"}}',
                    "",
                ]
            body = "\n".join(lines).encode() + b"\n"
            content_type = "text/event-stream"
        else:
            tools = "tools" in value
            if protocol == "chat":
                message = ({"role":"assistant","tool_calls":[{"function":{"name":p.TOOL_NAME,"arguments":'{"value":"ok"}'}}]}
                           if tools else {"role":"assistant","content":"OK"})
                out = {"object":"chat.completion","model":"upstream-chat","choices":[{"message":message}]}
            elif protocol == "anthropic":
                blocks = ([{"type":"tool_use","name":p.TOOL_NAME,"input":{"value":"ok"}}]
                          if tools else [{"type":"text","text":"OK"}])
                out = {"type":"message","role":"assistant","model":"upstream-anthropic","content":blocks}
            else:
                outputs = ([{"type":"function_call","name":p.TOOL_NAME,"arguments":'{"value":"ok"}'}]
                           if tools else [{"type":"message","content":[{"type":"output_text","text":"OK"}]}])
                out = {"object":"response","status":"completed","model":"upstream-responses","output":outputs}
            body = json.dumps(out).encode()
            content_type = "application/json"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("x-request-id", "mock-id")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ProtocolScriptTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)

    def test_all_nine_protocol_checks(self):
        for protocol in p.PROTOCOLS:
            for check in p.CHECKS:
                with self.subTest(protocol=protocol, check=check):
                    result = p.execute(self.base, FAKE_KEY, protocol, check, MODEL, 128, 3)
                    self.assertEqual(result.status, "PASS", result)
                    self.assertEqual(result.http, 200)
                    self.assertEqual(result.request_id, "mock-id")
                    self.assertTrue(result.model.startswith("upstream-"))

    def test_503_is_reported_and_secret_redacted(self):
        result = p.execute(self.base, FAKE_KEY, "chat", "json", "raise-503", 128, 3)
        self.assertEqual(result.status, "FAIL")
        self.assertEqual(result.http, 503)
        self.assertIn("No available channel", result.detail)
        self.assertNotIn(FAKE_KEY, result.detail)

    def test_stream_parser_rejects_incomplete_or_invalid_sse(self):
        self.assertRaises(p.TestError, p.check_stream, "chat", [
            ("", {"choices": [{"delta": {"content": "Hi"}}]})
        ])
        self.assertRaises(p.TestError, p.parse_sse, io.BytesIO(
            b"event: message_start\ndata: {bad}\n\n"
        ))

    def test_payload_preserves_client_protocol_conventions(self):
        chat = p.payload_for("chat", "tools", MODEL, 128)
        anthropic = p.payload_for("anthropic", "tools", MODEL, 128)
        responses = p.payload_for("responses", "tools", MODEL, 128)
        self.assertEqual(chat["tools"][0]["function"]["name"], p.TOOL_NAME)
        self.assertEqual(anthropic["tools"][0]["input_schema"]["type"], "object")
        self.assertEqual(responses["tools"][0]["type"], "function")
        self.assertEqual(responses["max_output_tokens"], 128)
        self.assertEqual(anthropic["max_tokens"], 128)


if __name__ == "__main__":
    unittest.main()
