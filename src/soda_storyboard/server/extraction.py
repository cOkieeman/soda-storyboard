"""Multipart extraction endpoints; uploaded source bytes stay in memory."""

from __future__ import annotations

import io
import uuid
from email import policy
from email.parser import BytesParser
from typing import TYPE_CHECKING

from PIL import Image, UnidentifiedImageError

from soda_storyboard.extract import draw_extraction_preview, extract_image, save_template
from soda_storyboard.io import read_json, write_json

from .common import APIError, identifier

if TYPE_CHECKING:
    from .app import Handler

MAX_UPLOAD = 16 * 1024 * 1024
MAX_NAME = 120


def upload(handler: Handler) -> None:
    if handler.headers.get("Transfer-Encoding"):
        raise APIError(400, "Upload requires Content-Length")
    length = int(handler.headers.get("Content-Length", "0"))
    if not 0 < length <= MAX_UPLOAD:
        raise APIError(400, "Upload must be 1 byte to 16 MiB")
    if handler.headers.get_content_type() != "multipart/form-data":
        raise APIError(400, "Expected multipart/form-data with image field")
    content_type = handler.headers.get("Content-Type", "")
    raw = handler.rfile.read(length)
    if len(raw) != length:
        raise APIError(400, "Incomplete upload")
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + raw
    )
    if not message.is_multipart() or message.defects:
        raise APIError(400, "Malformed multipart upload")
    fields = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name not in {"image", "direction", "mode"} or name in fields or part.defects:
            raise APIError(400, "Only one image and optional direction are allowed")
        fields[name] = part
    if "image" not in fields:
        raise APIError(400, "Missing image field")
    direction = (
        fields["direction"].get_payload(decode=True).decode("utf-8") if "direction" in fields else "rtl"
    )
    data = fields["image"].get_payload(decode=True)
    mode = fields["mode"].get_payload(decode=True).decode("utf-8") if "mode" in fields else "auto"
    source = fields["image"].get_filename() or "reference.png"
    store = handler.server.store
    extraction_id = uuid.uuid4().hex
    relative = f".server/extractions/{extraction_id}.png"
    try:
        with Image.open(io.BytesIO(data)) as image:
            result = extract_image(image, direction=direction, source_name=source, mode=mode)
            with store.lock:
                draw_extraction_preview(image, result, store.path(relative))
    except (UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise APIError(400, "Invalid or oversized image") from exc
    with store.lock:
        write_json(store.path(f".server/extractions/{extraction_id}.json"), result)
    handler.send(200, {**result, "extraction_id": extraction_id, "preview_url": f"/api/files/{relative}"})


def save(handler: Handler, body: dict) -> None:
    if body.keys() - {"extraction_id", "name"}:
        raise APIError(400, "Expected extraction_id and optional name")
    extraction_id = identifier(body.get("extraction_id", ""))
    name = body.get("name")
    if name is not None and (not isinstance(name, str) or not name.strip() or len(name) > MAX_NAME):
        raise APIError(400, "name must contain 1 to 120 characters")
    store = handler.server.store
    with store.lock:
        result = read_json(store.path(f".server/extractions/{extraction_id}.json"))
        path = save_template(result, store.path("templates"), name=name)
    handler.send(201, {"template": read_json(path), "path": path.relative_to(store.root).as_posix()})
