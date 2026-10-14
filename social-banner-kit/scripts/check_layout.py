#!/usr/bin/env python3
"""Read-only checks for complete banner kits and their visible-content geometry."""

import argparse
import json
import math
from pathlib import Path
import sys
from urllib.parse import urlparse

DECORATIVE = {"background", "pattern", "peripheral"}
DEFAULT_PROFILES = Path(__file__).resolve().parents[1] / "references" / "platforms.json"


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def rectangle(value):
    return (isinstance(value, list) and len(value) == 4
            and all(numeric(x) for x in value) and value[2] > 0 and value[3] > 0)


def inside(box, container, padding=0):
    x, y, w, h = box
    sx, sy, sw, sh = container
    return (x >= sx + padding and y >= sy + padding
            and x + w <= sx + sw - padding and y + h <= sy + sh - padding)


def hits_circle(box, circle):
    x, y, w, h = box
    nearest_x = max(x, min(circle["cx"], x + w))
    nearest_y = max(y, min(circle["cy"], y + h))
    radius = circle["radius"] + circle.get("clearance", 0)
    return (nearest_x - circle["cx"]) ** 2 + (nearest_y - circle["cy"]) ** 2 <= radius ** 2


def web_source(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def validate(manifest, base, profiles, geometry_only=False):
    errors = []
    if not isinstance(manifest, dict):
        return ["Manifest must be an object"]
    kits = manifest.get("kits")
    platforms = manifest.get("platforms")
    outputs = manifest.get("outputs")
    if not isinstance(kits, int) or isinstance(kits, bool) or kits < 1:
        return ["kits must be a positive integer"]
    if (not isinstance(platforms, list) or not platforms
            or any(not isinstance(p, str) or p not in {"vk", "rutube", "youtube"} for p in platforms)
            or len(platforms) != len(set(platforms))):
        return ["platforms must be unique entries chosen from vk, rutube, youtube"]
    if not isinstance(outputs, list):
        return ["outputs must be a list"]
    expected = {(k, p) for k in range(1, kits + 1) for p in platforms}
    seen = set()
    files = set()
    for index, output in enumerate(outputs, 1):
        label = f"output {index}"
        if not isinstance(output, dict):
            errors.append(f"{label}: must be an object")
            continue
        kit, platform = output.get("kit"), output.get("platform")
        if not isinstance(kit, int) or isinstance(kit, bool) or not isinstance(platform, str):
            errors.append(f"{label}: invalid kit/platform")
            continue
        pair = (kit, platform)
        label = f"kit {kit} / {platform}"
        if pair not in expected:
            errors.append(f"{label}: not requested")
        if pair in seen:
            errors.append(f"{label}: duplicate adaptation")
        seen.add(pair)
        profile_name = output.get("profile", platform)
        if not isinstance(profile_name, str) or profile_name not in profiles:
            errors.append(f"{label}: unknown profile")
            continue
        profile = profiles[profile_name]
        if profile.get("platform", profile_name) != platform:
            errors.append(f"{label}: profile belongs to another platform")
        canvas, safe = profile["canvas"], profile["safe_rect"]
        filename = output.get("file")
        if not isinstance(filename, str) or not filename:
            errors.append(f"{label}: missing final filename")
            filepath = None
        else:
            filepath = (base / filename).resolve()
            if filepath in files:
                errors.append(f"{label}: final file is reused by another output")
            files.add(filepath)
        fonts = output.get("fonts", [])
        families = set()
        if not isinstance(fonts, list):
            errors.append(f"{label}: fonts must be a list")
            fonts = []
        for font in fonts:
            if not isinstance(font, dict) or not isinstance(font.get("family"), str):
                errors.append(f"{label}: invalid font record")
                continue
            family = font["family"]
            if not family:
                errors.append(f"{label}: empty font family")
            families.add(family)
            if not web_source(font.get("source_url")):
                errors.append(f"{label}: font {family} lacks website source")
            font_file = font.get("file")
            if (not geometry_only and (not isinstance(font_file, str)
                    or not (base / font_file).is_file()
                    or (base / font_file).stat().st_size == 0)):
                errors.append(f"{label}: font {family} file missing/empty")
        if len(families) > 2:
            errors.append(f"{label}: more than two font families")
        elements = output.get("elements")
        if not isinstance(elements, list) or not elements:
            errors.append(f"{label}: missing visible elements")
            elements = []
        sizes, element_ids = set(), set()
        has_logo = False
        for item_index, element in enumerate(elements, 1):
            prefix = f"{label}: element {item_index}"
            if not isinstance(element, dict):
                errors.append(f"{prefix}: must be an object")
                continue
            element_id = element.get("id")
            if not isinstance(element_id, str) or not element_id or element_id in element_ids:
                errors.append(f"{prefix}: missing/duplicate id")
            else:
                element_ids.add(element_id)
                prefix = f"{label}: {element_id}"
            role = element.get("role")
            if not isinstance(role, str) or not role:
                errors.append(f"{prefix}: missing role")
            bbox = element.get("bbox")
            if not rectangle(bbox):
                errors.append(f"{prefix}: bbox must contain finite x,y,positive width,height")
                continue
            if role not in DECORATIVE:
                if not inside(bbox, safe, profile.get("padding", 0)):
                    errors.append(f"{prefix}: outside safe content area including padding")
                for exclusion in profile.get("exclusions", []):
                    if exclusion["type"] == "circle" and hits_circle(bbox, exclusion):
                        errors.append(f"{prefix}: intersects avatar exclusion including clearance")
            if role == "logo":
                has_logo = True
                if not web_source(element.get("asset_source_url")):
                    errors.append(f"{prefix}: original logo lacks website source")
            if "text" in element:
                if not isinstance(element["text"], str) or not element["text"].strip():
                    errors.append(f"{prefix}: empty/invalid text")
                if role in DECORATIVE:
                    errors.append(f"{prefix}: typeset text cannot be marked decorative")
                size = element.get("font_size")
                if not numeric(size) or size <= 0:
                    errors.append(f"{prefix}: invalid font size")
                else:
                    sizes.add(round(size, 6))
                if element.get("font_family") not in families:
                    errors.append(f"{prefix}: font family has no sourced font record")
        if not has_logo:
            errors.append(f"{label}: missing original website logo")
        if len(sizes) > 3:
            errors.append(f"{label}: more than three typeset font sizes")
        if not geometry_only and filepath is not None:
            if not filepath.is_file():
                errors.append(f"{label}: final image is missing")
            else:
                max_bytes = profile.get("max_bytes")
                if max_bytes and filepath.stat().st_size > max_bytes:
                    errors.append(f"{label}: exceeds {max_bytes} bytes")
                try:
                    from PIL import Image
                    with Image.open(filepath) as image:
                        if list(image.size) != canvas:
                            errors.append(f"{label}: image dimensions {image.size} differ from {canvas}")
                        if image.format not in profile["formats"]:
                            errors.append(f"{label}: unsupported file format {image.format}")
                        image.verify()
                except ImportError:
                    errors.append("Pillow is required for final image verification")
                except Exception as error:
                    errors.append(f"{label}: unreadable image ({type(error).__name__})")
    for kit, platform in sorted(expected - seen):
        errors.append(f"kit {kit} / {platform}: missing adaptation")
    return errors


def compare_locked_geometry(manifest, baseline):
    """Require identical element identities and positions for a composition-locked edit."""
    def positions(document):
        return {(output["kit"], output["platform"], element["id"]): element["bbox"]
                for output in document["outputs"] for element in output["elements"]}
    before, after = positions(baseline), positions(manifest)
    errors = []
    for identity in sorted(set(before) | set(after)):
        if identity not in before or identity not in after:
            errors.append(f"locked composition: element added/removed {identity}")
        elif before[identity] != after[identity]:
            errors.append(f"locked composition: position/size changed {identity}")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--profiles", type=Path, default=DEFAULT_PROFILES,
                        help="Use a documented project-specific template when explicitly supplied")
    parser.add_argument("--geometry-only", action="store_true",
                        help="Pre-export check only; does not approve final deliverables")
    parser.add_argument("--baseline", type=Path,
                        help="Compare every element bbox with the previous composition-locked version")
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        profiles = json.loads(args.profiles.read_text(encoding="utf-8"))["profiles"]
        errors = validate(manifest, args.manifest.resolve().parent, profiles, args.geometry_only)
        if args.baseline:
            baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
            errors.extend(compare_locked_geometry(manifest, baseline))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"ERROR: {type(error).__name__}: {error}", file=sys.stderr)
        return 2
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    stage = "GEOMETRY ONLY — export still required" if args.geometry_only else "FINAL FILES"
    print(f"PASS ({stage}): {manifest['kits']} kit(s), {len(manifest['outputs'])} adaptation(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
