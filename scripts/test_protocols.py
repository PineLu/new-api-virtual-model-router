#!/usr/bin/env python3
"""Live integration smoke test for New API's Chat, Anthropic, and Responses routes.

Only uses the Python standard library. Never logs or writes NEW_API_KEY.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

PATHS = {
    "chat": "/v1/chat/completions",
    "anthropic": "/v1/messages",
    "responses": "/v1/responses",
}
PROTOCOLS = tuple(PATHS)
CHECKS = ("json", "stream", "tools")
TOOL_NAME = "vmr_probe"
TOOL_PARAMS = {
    "type": "object",
    "properties": {"value": {"type": "string"}},
    "required": ["value"],
}
MAX_BODY = 2_000_000
MAX_EVENTS = 2_000


@dataclass
class Result:
    protocol: str
    check: str
    status: str
    http: int | None
    seconds: float
    model: str = ""
    detail: str = ""
    request_id: str = ""


class TestError(Exception):
    pass


def safe_error(body: bytes, key: str) -> str:
    message = body[:2048].decode("utf-8", "replace")
    try:
        parsed = json.loads(message)
        if isinstance(parsed, dict):
            err = parsed.get("error", parsed)
            if isinstance(err, dict):
                message = str(err.get("message", err))
            else:
                message = str(err)
    except json.JSONDecodeError:
        pass
    return message.replace(key, "[REDACTED]")[:450]


def payload_for(protocol: str, check: str, model: str, max_tokens: int) -> dict[str, Any]:
    prompt = "Say exactly VMR_PROTOCOL_OK. Do not add explanations."
    if check == "tools":
        prompt = "Call the vmr_probe function with value set to 'ok'. Do not answer in plain text."
    if protocol == "chat":
        payload: dict[str, Any] = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "stream": check == "stream",
        }
        if check == "tools":
            payload["tools"] = [{
                "type": "function",
                "function": {
                    "name": TOOL_NAME,
                    "description": "Record one short probe value.",
                    "parameters": TOOL_PARAMS,
                },
            }]
            payload["tool_choice"] = "required"
    elif protocol == "anthropic":
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "stream": check == "stream",
        }
        if check == "tools":
            payload["tools"] = [{
                "name": TOOL_NAME,
                "description": "Record one short probe value.",
                "input_schema": TOOL_PARAMS,
            }]
            payload["tool_choice"] = {"type": "tool", "name": TOOL_NAME}
    else:
        payload = {
            "model": model,
            "input": prompt,
            "max_output_tokens": max_tokens,
            "stream": check == "stream",
        }
        if check == "tools":
            payload["tools"] = [{
                "type": "function",
                "name": TOOL_NAME,
                "description": "Record one short probe value.",
                "parameters": TOOL_PARAMS,
            }]
            payload["tool_choice"] = "required"
    return payload


def parse_sse(response: Any) -> list[tuple[str, Any]]:
    """Read SSE events, handling multiple data lines, CRLF and [DONE]."""
    events: list[tuple[str, Any]] = []
    name = ""
    data_lines: list[str] = []
    total = 0

    def flush() -> None:
        nonlocal name, data_lines
        if not data_lines:
            name = ""
            return
        raw = "\n".join(data_lines)
        if raw == "[DONE]":
            payload: Any = "[DONE]"
        else:
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise TestError(f"invalid SSE JSON ({name or 'data'}): {exc}") from exc
        events.append((name, payload))
        name = ""
        data_lines = []
        if len(events) > MAX_EVENTS:
            raise TestError("SSE exceeded event limit")

    for raw_line in response:
        total += len(raw_line)
        if total > MAX_BODY:
            raise TestError("SSE exceeded response byte limit")
        line = raw_line.decode("utf-8", "replace").rstrip("\r\n")
        if line == "":
            flush()
        elif line.startswith(":"):
            continue
        elif line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip(" "))
    flush()
    return events


def check_json(protocol: str, body: dict[str, Any], tools: bool) -> tuple[str, str]:
    if body.get("error") is not None:
        raise TestError(str(body["error"])[:250])
    if protocol == "chat":
        if body.get("object") != "chat.completion":
            raise TestError(f"expected chat.completion, got {body.get('object')!r}")
        choices = body.get("choices")
        if (not isinstance(choices, list) or not choices
                or not isinstance(choices[0], dict)
                or not isinstance(choices[0].get("message"), dict)):
            raise TestError("missing choices[0].message")
        message = choices[0]["message"]
        if tools:
            calls = message.get("tool_calls", [])
            if not any(c.get("function", {}).get("name") == TOOL_NAME for c in calls if isinstance(c, dict)):
                raise TestError("missing Chat tool_calls[vmr_probe]")
            detail = "tool call present"
        else:
            detail = "content present" if message.get("content") else "valid response; text empty (possible reasoning-only output)"
    elif protocol == "anthropic":
        if body.get("type") != "message" or body.get("role") != "assistant":
            raise TestError("expected Anthropic assistant message")
        content = body.get("content")
        if not isinstance(content, list):
            raise TestError("missing Anthropic content blocks")
        if tools:
            if not any(b.get("type") == "tool_use" and b.get("name") == TOOL_NAME for b in content if isinstance(b, dict)):
                raise TestError("missing Anthropic tool_use[vmr_probe]")
            detail = "tool_use present"
        else:
            detail = "content present" if any(b.get("text") for b in content if isinstance(b, dict)) else "valid message; text empty"
    else:
        if body.get("object") != "response":
            raise TestError(f"expected Responses object=response, got {body.get('object')!r}")
        outputs = body.get("output")
        if not isinstance(outputs, list):
            raise TestError("missing Responses output list")
        if body.get("status") in ("failed", "incomplete"):
            raise TestError(f"Responses status={body['status']}")
        if tools:
            if not any(o.get("type") == "function_call" and o.get("name") == TOOL_NAME for o in outputs if isinstance(o, dict)):
                raise TestError("missing Responses function_call[vmr_probe]")
            detail = "function_call present"
        else:
            texts = [
                item.get("text")
                for o in outputs if isinstance(o, dict)
                for item in (o.get("content") or []) if isinstance(item, dict)
            ]
            detail = "output text present" if any(texts) else "valid response; output text empty"
    return str(body.get("model", "")), detail


def check_stream(protocol: str, events: list[tuple[str, Any]]) -> tuple[str, str]:
    if not events:
        raise TestError("empty SSE event sequence")
    types = [
        (name or str(data.get("type", ""))) if isinstance(data, dict) else name
        for name, data in events
    ]
    for event_type, (_, data) in zip(types, events):
        if event_type in ("error", "response.failed", "response.incomplete"):
            raise TestError(f"SSE terminal error: {event_type}: {str(data)[:180]}")
        if isinstance(data, dict) and data.get("error"):
            raise TestError(f"SSE error: {str(data['error'])[:180]}")
    model = ""
    for _, data in events:
        if isinstance(data, dict):
            model = model or str(data.get("model", ""))
            if protocol == "anthropic" and isinstance(data.get("message"), dict):
                model = model or str(data["message"].get("model") or "")
            if protocol == "responses" and isinstance(data.get("response"), dict):
                model = model or str(data["response"].get("model") or "")
    if protocol == "chat":
        chunks = [d for _, d in events if isinstance(d, dict) and isinstance(d.get("choices"), list)]
        if not chunks:
            raise TestError("missing Chat SSE choices chunks")
        if not any(data == "[DONE]" for _, data in events):
            raise TestError("missing Chat SSE [DONE]")
        return model, f"{len(chunks)} Chat chunks; [DONE] present"
    if protocol == "anthropic":
        if "message_start" not in types or "message_stop" not in types:
            raise TestError(f"missing Anthropic message_start/message_stop: {types[:12]}")
        return model, f"{len(events)} Anthropic SSE events; message_stop present"
    if "response.created" not in types or "response.completed" not in types:
        raise TestError(f"missing Responses response.created/response.completed: {types[:12]}")
    return model, f"{len(events)} Responses SSE events; response.completed present"


def execute(base: str, key: str, protocol: str, check: str,
            model: str, max_tokens: int, timeout: float) -> Result:
    start = time.monotonic()
    status: int | None = None
    request_id = ""
    try:
        body = json.dumps(payload_for(protocol, check, model, max_tokens)).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream" if check == "stream" else "application/json",
        }
        if protocol == "anthropic":
            # Match the native Anthropic SDK: New API rc.51 accepts x-api-key
            # and performs its own Bearer translation in auth middleware.
            headers["x-api-key"] = key
            headers["anthropic-version"] = "2023-06-01"
        else:
            headers["Authorization"] = f"Bearer {key}"
        request = urllib.request.Request(base + PATHS[protocol], body, headers, method="POST")
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            request_id = response.headers.get("x-request-id", "")
            if check == "stream":
                content_type = response.headers.get("content-type", "").lower()
                if "text/event-stream" not in content_type:
                    raise TestError(f"expected text/event-stream, got {content_type!r}")
                selected, detail = check_stream(protocol, parse_sse(response))
            else:
                raw = response.read(MAX_BODY + 1)
                if len(raw) > MAX_BODY:
                    raise TestError("JSON exceeded response byte limit")
                try:
                    value = json.loads(raw)
                except json.JSONDecodeError as exc:
                    raise TestError(f"invalid JSON response: {exc}") from exc
                if not isinstance(value, dict):
                    raise TestError("JSON response is not an object")
                selected, detail = check_json(protocol, value, check == "tools")
        result = Result(protocol, check, "PASS", status, time.monotonic() - start,
                        selected, detail, request_id)
    except urllib.error.HTTPError as exc:
        status = exc.code
        request_id = exc.headers.get("x-request-id", "")
        result = Result(protocol, check, "FAIL", status, time.monotonic() - start,
                        detail=safe_error(exc.read(2048), key), request_id=request_id)
    except (urllib.error.URLError, TimeoutError, OSError, TestError) as exc:
        result = Result(protocol, check, "FAIL", status, time.monotonic() - start,
                        detail=str(exc).replace(key, "[REDACTED]")[:450],
                        request_id=request_id)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("NEW_API_BASE_URL", "http://localhost:3003"))
    parser.add_argument("--model", default=os.environ.get("NEW_API_MODEL", "deepseek-flash"))
    parser.add_argument("--protocols", choices=PROTOCOLS, nargs="+", default=list(PROTOCOLS))
    parser.add_argument("--checks", choices=CHECKS, nargs="+", default=list(CHECKS))
    parser.add_argument("--timeout", type=float, default=45)
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument("--delay", type=float, default=0.0, help="Seconds between requests (useful for free model rate limits)")
    parser.add_argument("--json-report", type=Path, help="Write a credential-free JSON report")
    args = parser.parse_args(argv)
    key = os.environ.get("NEW_API_KEY", "").strip()
    if not key:
        parser.error("NEW_API_KEY environment variable is required; do not put secrets on the command line")
    if not args.base_url.startswith(("http://", "https://")):
        parser.error("--base-url must start with http:// or https://")
    if args.timeout <= 0 or args.max_tokens < 1 or args.delay < 0:
        parser.error("--timeout and --max-tokens must be positive; --delay must be >= 0")

    base = args.base_url.rstrip("/")
    results: list[Result] = []
    print(f"New API protocol test | base={base} | model={args.model} | token group is determined by NEW_API_KEY")
    print("Protocol conversion is verified at the response shape level; gateway channel routing requires separate log inspection.")
    for protocol in args.protocols:
        for check in args.checks:
            result = execute(base, key, protocol, check, args.model, args.max_tokens, args.timeout)
            results.append(result)
            print(f"[{result.status}] {protocol:9} {check:6} HTTP {str(result.http or '-'):3} "
                  f"{result.seconds:6.2f}s model={result.model or '-'} | {result.detail}"
                  + (f" | request_id={result.request_id}" if result.request_id else ""), flush=True)
            if args.delay and (protocol, check) != (args.protocols[-1], args.checks[-1]):
                time.sleep(args.delay)
    passed = sum(x.status == "PASS" for x in results)
    failed = len(results) - passed
    print(f"\nSummary: {passed} PASS, {failed} FAIL, {len(results)} total")
    if args.json_report:
        report = {
            "base_url": base, "model": args.model,
            "summary": {"passed": passed, "failed": failed, "total": len(results)},
            "cases": [asdict(item) for item in results],
        }
        args.json_report.parent.mkdir(parents=True, exist_ok=True)
        args.json_report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(f"Report written to: {args.json_report}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
