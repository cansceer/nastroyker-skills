#!/usr/bin/env python3
"""Local image contact sheets and perceptual similarity; no external uniqueness claims."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    from PIL import Image, ImageDraw, ImageOps
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--distance', type=int, default=6)
    args = parser.parse_args()
    source, output = Path(args.input), Path(args.output)
    if not source.is_dir():
        parser.error('input directory does not exist')
    output.mkdir(parents=True, exist_ok=True)
    records, thumbnails, skipped = [], [], []
    for file in sorted(source.iterdir()):
        if not file.is_file():
            continue
        try:
            with Image.open(file) as opened:
                oriented = ImageOps.exif_transpose(opened).convert('RGBA')
                image = Image.alpha_composite(Image.new('RGBA', oriented.size, 'white'), oriented).convert('RGB')
                reduced = image.convert('L').resize((9, 8), Image.Resampling.LANCZOS)
                pixels = [reduced.getpixel((x, y)) for y in range(8) for x in range(9)]
                dhash = sum((pixels[y * 9 + x] > pixels[y * 9 + x + 1]) << (y * 8 + x) for y in range(8) for x in range(8))
                digest = hashlib.sha256(file.read_bytes()).hexdigest()
                records.append({'file': str(file.resolve()), 'sha256': digest, 'width': image.width, 'height': image.height, 'bytes': file.stat().st_size, 'frames': getattr(opened, 'n_frames', 1), 'dhash': f'{dhash:016x}', 'semanticStatus': 'not_checked', 'externalUniqueness': 'not_checked'})
                thumbnail = ImageOps.contain(image, (280, 190))
                cell = Image.new('RGB', (300, 235), 'white')
                cell.paste(thumbnail, ((300 - thumbnail.width) // 2, (195 - thumbnail.height) // 2))
                draw = ImageDraw.Draw(cell)
                draw.text((10, 198), f'{len(records):03d} {file.name[:24]}', fill='black')
                draw.text((10, 214), f'{image.width}x{image.height}  {file.stat().st_size} bytes', fill='black')
                thumbnails.append(cell)
        except Exception as error:
            skipped.append({'file': str(file.resolve()), 'reason': f'{type(error).__name__}: unsupported/undecodable image; review original in browser'})
    similar = []
    for i, left in enumerate(records):
        for right in records[i + 1:]:
            distance = (int(left['dhash'], 16) ^ int(right['dhash'], 16)).bit_count()
            if distance <= args.distance:
                similar.append({'left': left['file'], 'right': right['file'], 'distance': distance, 'assessment': 'candidate-only; visually compare and assess block relevance'})
    sheets = []
    for start in range(0, len(thumbnails), 20):
        batch = thumbnails[start:start + 20]
        sheet = Image.new('RGB', (1200, ((len(batch) + 3) // 4) * 235), '#dddddd')
        for index, thumb in enumerate(batch):
            sheet.paste(thumb, ((index % 4) * 300, (index // 4) * 235))
        filename = output / f'contact-sheet-{start // 20 + 1:03d}.jpg'
        sheet.save(filename, quality=90)
        sheets.append(str(filename.resolve()))
    data = {'images': records, 'similarCandidates': similar, 'sheets': sheets, 'skipped': skipped, 'externalUniqueness': 'not_checked', 'note': 'Perceptual similarity does not prove external uniqueness, copyright, authorship or inappropriate reuse.'}
    (output / 'images.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Images: {len(records)}; contact sheets: {len(sheets)}; similarity candidates: {len(similar)}; skipped: {len(skipped)}')


if __name__ == '__main__':
    main()
