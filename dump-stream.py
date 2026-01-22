#!/usr/bin/env python3
"""Dump the XMTP global envelope stream (subscribe-all) to stdout.

This connects to the XMTP Message API subscribe-all endpoint and prints each
newline-delimited JSON envelope as it arrives.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from typing import Dict, Iterable, Optional
from urllib import request

API_URLS: Dict[str, str] = {
    "local": "http://localhost:5555",
    "dev": "https://dev.xmtp.network",
    "production": "https://production.xmtp.network",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stream and dump the XMTP global envelope feed (subscribe-all)."
    )
    parser.add_argument(
        "--env",
        choices=sorted(API_URLS.keys()),
        default="production",
        help="XMTP environment base URL (default: production).",
    )
    parser.add_argument(
        "--base-url",
        default="",
        help="Override base URL (e.g. https://production.xmtp.network).",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Print raw NDJSON lines without parsing.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output.",
    )
    parser.add_argument(
        "--topic-contains",
        default="",
        help="Only emit envelopes whose contentTopic contains this string.",
    )
    parser.add_argument(
        "--topic-prefix",
        default="",
        help="Only emit envelopes whose contentTopic starts with this prefix.",
    )
    parser.add_argument(
        "--max-messages",
        type=int,
        default=0,
        help="Stop after N messages (0 = unlimited).",
    )
    parser.add_argument(
        "--omit-message",
        action="store_true",
        help="Exclude the base64 message field from output.",
    )
    parser.add_argument(
        "--message-max",
        type=int,
        default=0,
        help="Truncate base64 message to N chars (0 = no truncation).",
    )
    parser.add_argument(
        "--decode-message",
        action="store_true",
        help="Decode message bytes and include hex + length fields.",
    )
    parser.add_argument(
        "--hex-max",
        type=int,
        default=256,
        help="Max decoded bytes to include in hex (0 = no truncation).",
    )
    return parser.parse_args()


def iter_lines(resp: request.addinfourl) -> Iterable[str]:
    for raw in resp:
        if not raw:
            continue
        line = raw.decode("utf-8", errors="replace").strip()
        if line:
            yield line


def should_emit(topic: Optional[str], contains: str, prefix: str) -> bool:
    if not topic:
        return False if (contains or prefix) else True
    if contains and contains not in topic:
        return False
    if prefix and not topic.startswith(prefix):
        return False
    return True


def decode_message_bytes(message_b64: str) -> Optional[bytes]:
    try:
        # Pad if needed for base64 decoding
        padding = "=" * ((4 - (len(message_b64) % 4)) % 4)
        return base64.b64decode(message_b64 + padding, validate=False)
    except Exception:
        return None


def format_envelope(
    envelope: dict,
    args: argparse.Namespace,
) -> Optional[str]:
    topic = envelope.get("contentTopic")
    if not should_emit(topic, args.topic_contains, args.topic_prefix):
        return None

    output = dict(envelope)

    message_b64 = output.get("message")
    if isinstance(message_b64, str):
        if args.decode_message:
            raw = decode_message_bytes(message_b64)
            if raw is not None:
                output["messageBytesLen"] = len(raw)
                if args.hex_max == 0 or len(raw) <= args.hex_max:
                    output["messageBytesHex"] = raw.hex()
                else:
                    clipped = raw[: args.hex_max]
                    output["messageBytesHex"] = (
                        f"{clipped.hex()}...(+{len(raw) - args.hex_max} bytes)"
                    )
            else:
                output["messageBytesLen"] = None
                output["messageBytesHex"] = None
        if args.message_max and args.message_max > 0:
            if len(message_b64) > args.message_max:
                output["message"] = message_b64[: args.message_max] + "..."
        if args.omit_message:
            output.pop("message", None)
    else:
        if args.omit_message:
            output.pop("message", None)

    indent = 2 if args.pretty else None
    return json.dumps(output, indent=indent, ensure_ascii=True)


def main() -> int:
    args = parse_args()

    base_url = args.base_url.strip() or API_URLS[args.env]
    url = base_url.rstrip("/") + "/message/v1/subscribe-all"

    req = request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    count = 0
    try:
        with request.urlopen(req) as resp:
            for line in iter_lines(resp):
                if args.raw:
                    print(line, flush=True)
                else:
                    try:
                        payload = json.loads(line)
                        envelope = payload.get("result", payload)
                    except json.JSONDecodeError:
                        print(line, file=sys.stderr, flush=True)
                        continue

                    rendered = format_envelope(envelope, args)
                    if rendered is not None:
                        print(rendered, flush=True)

                count += 1
                if args.max_messages and count >= args.max_messages:
                    break
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
