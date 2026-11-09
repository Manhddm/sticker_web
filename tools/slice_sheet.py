"""Cuts an AI sticker sheet (subjects on a flat white background) into one transparent PNG per subject.
Background = near-white pixels connected to the image border; each remaining blob big enough is a sticker,
numbered in reading order (rows top to bottom, then left to right).
Run: python tools/slice_sheet.py <sheet.png> <out_dir> [prefix]   (no arguments: self-check)"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter


def label(mask):
    """4-connected blobs of a small boolean mask: (labels, boxes) with boxes[i] = (y0, y1, x0, x1) of blob i+1."""
    h, w = mask.shape
    lab = np.zeros((h, w), int)
    boxes = []
    for y, x in zip(*np.nonzero(mask)):
        if lab[y, x]:
            continue
        n = len(boxes) + 1
        lab[y, x] = n
        q, box = deque([(y, x)]), [y, y + 1, x, x + 1]
        while q:
            cy, cx = q.popleft()
            box = [min(box[0], cy), max(box[1], cy + 1), min(box[2], cx), max(box[3], cx + 1)]
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = n
                    q.append((ny, nx))
        boxes.append(box)
    return lab, boxes


def slice_sheet(path, out_dir, prefix='', white=232, min_share=0.004, pad=6, step=4):
    src = Image.open(path).convert('RGB')
    im = np.asarray(src).astype(int)
    h, w, _ = im.shape
    # Background: near-white connected to the border (flood fill on a light/dark map from every edge pixel).
    light = Image.fromarray(np.where(im.min(axis=2) >= white, 255, 0).astype(np.uint8))
    small = np.asarray(light.resize((w // step, h // step), Image.NEAREST)) > 0
    lab, boxes = label(small)
    sh, sw = small.shape
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg_small = np.isin(lab, list(edge))
    bg = np.asarray(Image.fromarray(bg_small.astype(np.uint8) * 255).resize((w, h), Image.NEAREST)) > 0
    # Refine the coarse edge at full size, then eat 2px for the kiss-cut hairline some sheets draw.
    bg = bg | ((im.min(axis=2) >= white) & (np.asarray(Image.fromarray(bg.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(2 * step + 1))) > 0))
    fg = np.asarray(Image.fromarray((~bg).astype(np.uint8) * 255).filter(ImageFilter.MinFilter(5))) > 0
    blobs_small, boxes = label(np.asarray(Image.fromarray(fg.astype(np.uint8) * 255).resize((sw, sh), Image.NEAREST)) > 0)
    blobs = np.asarray(Image.fromarray(blobs_small.astype(np.int32)).resize((w, h), Image.NEAREST)) * fg
    keep = [(i + 1, b) for i, b in enumerate(boxes) if (blobs_small == i + 1).sum() >= min_share * sh * sw]
    keep.sort(key=lambda kb: kb[1][0])
    # Rows: a blob starting below the current row's first blob bottom opens a new row; each row left to right.
    ordered, row, bottom = [], [], None
    for kb in keep:
        if row and kb[1][0] >= bottom:
            ordered += sorted(row, key=lambda r: r[1][2]); row = []
        if not row: bottom = kb[1][1]
        row.append(kb)
    ordered += sorted(row, key=lambda r: r[1][2])
    os.makedirs(out_dir, exist_ok=True)
    out = []
    for k, (i, b) in enumerate(ordered, 1):
        y0, y1 = max(0, b[0] * step - pad), min(h, b[1] * step + pad)
        x0, x1 = max(0, b[2] * step - pad), min(w, b[3] * step + pad)
        crop = np.dstack([im[y0:y1, x0:x1], np.where(blobs[y0:y1, x0:x1] == i, 255, 0)]).astype(np.uint8)
        name = os.path.join(out_dir, '%s%02d.png' % (prefix, k))
        Image.fromarray(crop).save(name)
        out.append((name, x1 - x0, y1 - y0))
    return out


def self_check():
    """Two red blobs on top, one blue below: three stickers in reading order, the white around them clear."""
    import tempfile
    im = Image.new('RGB', (400, 400), 'white')
    px = im.load()
    for y in range(30, 130):
        for x in range(30, 130): px[x, y] = (200, 30, 30)
        for x in range(250, 370): px[x, y] = (200, 30, 30)
    for y in range(240, 360):
        for x in range(150, 250): px[x, y] = (30, 30, 200)
    d = tempfile.mkdtemp()
    im.save(os.path.join(d, 's.png'))
    got = slice_sheet(os.path.join(d, 's.png'), d, 't')
    assert len(got) == 3, got
    a, b, c = (np.asarray(Image.open(g[0])) for g in got)
    assert a.shape[1] < b.shape[1] and tuple(c[c.shape[0] // 2, c.shape[1] // 2, :3]) == (30, 30, 200), 'reading order'
    assert a[0, 0, 3] == 0 and a[a.shape[0] // 2, a.shape[1] // 2, 3] == 255, 'alpha'
    print('self-check OK')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        self_check(); sys.exit(0)
    got = slice_sheet(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else '')
    for name, w, h in got:
        print(name, w, h)
    assert got, 'no stickers found'
