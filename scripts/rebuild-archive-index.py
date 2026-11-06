#!/usr/bin/env python3
"""Rebuild the searchable PYQ archive index without the Railway backend.

The archive PDFs live in Backblaze B2 under
    materials/pyq-archive/pyq/<year>/<uuid>.pdf
Their titles/subjects were stored only in the (now offline) Railway DB.  This
script reads the first page of each PDF (text layer when present, OCR when the
paper is a scan) and extracts paper name, course, semester and year.

It is designed to run either locally or in parallel GitHub Actions shards:

    python3 scripts/rebuild-archive-index.py --sample 20
    python3 scripts/rebuild-archive-index.py --workers 4 --shard-index 0 --shard-count 4
    python3 scripts/rebuild-archive-index.py --merge

Inputs:
    scripts/archive-data/keys.txt       one B2 key per line (23,814)
    scripts/archive-data/recovered.json 10,000 rows recovered from old snapshots

Outputs:
    /tmp/archive-ocr-results.jsonl      resumable OCR rows
    assets/data/pyq-archive-index.json  final compact search index
"""

import argparse
import concurrent.futures as futures
import json
import re
import sys
import threading
import time
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    import fitz  # PyMuPDF
except Exception:
    import pymupdf as fitz

import pytesseract
from PIL import Image

CDN = 'https://cdn.sulaksh.online/file/'
ROOT = Path(__file__).resolve().parent.parent
KEYS_FILE = ROOT / 'scripts/archive-data/keys.txt'
RECOVERED_FILE = ROOT / 'scripts/archive-data/recovered.json'
DEFAULT_OUT = Path('/tmp/archive-ocr-results.jsonl')
DEFAULT_INDEX = ROOT / 'assets/data/pyq-archive-index.json'

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

LABEL_SCORE_TERMS = (
    'name of the paper',
    'name of the course',
    'semester',
    'unique paper code',
    'question paper contains',
)

ROMAN = {
    'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8,
    'IX': 9, 'X': 10, 'XI': 11, 'XII': 12,
}

LABEL_RE = re.compile(
    r'^(?:Name\s+of\s+the\s+Paper|Name\s+of\s+Paper|Paper\s+Name|Title\s+of\s+the\s+Paper'
    r'|Name\s+of\s+the\s+Course|Name\s+of\s+Course|Course\s+Name'
    r'|Semester|Sem|Duration|Unique\s+Paper\s+Code|Maximum\s+Marks|Sr\.?\s*No\.?|Roll\s+No\.?)',
    re.I,
)

PAPER_RE = re.compile(
    r'^(?:Name\s+of\s+the\s+Paper|Name\s+of\s+Paper|Paper\s+Name|Title\s+of\s+the\s+Paper)\s*[:\-]?\s*(.*)$',
    re.I,
)
COURSE_RE = re.compile(
    r'^(?:Name\s+of\s+the\s+Course|Name\s+of\s+Course|Course\s+Name)\s*[:\-]?\s*(.*)$',
    re.I,
)

STOP_SPLIT_RE = re.compile(
    r'\b(?:Name\s+of\s+the\s+Course|Name\s+of\s+Course|Name\s+of\s+the\s+Paper|Name\s+of\s+Paper'
    r'|Paper\s+Name|Semester|Sem|Duration|Unique\s+Paper\s+Code|Maximum\s+Marks|Sr\.?\s*No\.?|Roll\s+No\.?)\b',
    re.I,
)

BOILERPLATE_RE = re.compile(
    r'(?:This\s+question\s+paper\s+contains|Your\s+Roll\s+No|Instructions?\s+for\s+Candidates'
    r'|Time\s+allowed|Maximum\s+Marks|Sr\.?\s*No\.?\s+of\s+Question|Unique\s+Paper\s+Code)',
    re.I,
)

_thread = threading.local()


def session():
    s = getattr(_thread, 'session', None)
    if s is None:
        s = requests.Session()
        retry = Retry(
            total=4, connect=4, read=4, backoff_factor=1.2,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=['GET'],
        )
        s.mount('https://', HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=8))
        s.headers.update({'User-Agent': UA})
        _thread.session = s
    return s


def norm_space(s: str) -> str:
    return re.sub(r'\s+', ' ', str(s or '')).strip()


def clean_value(v: str) -> str:
    v = norm_space(v).strip(' .,:;-–—')
    if not v:
        return ''
    v = STOP_SPLIT_RE.split(v, maxsplit=1)[0].strip(' .,:;-–—')
    if not v:
        return ''
    low = v.lower()
    if low in ('name of the paper', 'name of the course', 'paper', 'course', 'semester', 'sem'):
        return ''
    if BOILERPLATE_RE.search(v):
        return ''
    if len(v) > 140:
        v = v[:140].rsplit(' ', 1)[0].strip(' .,:;-–—')
    letters = sum(c.isalpha() for c in v)
    if letters < 2:
        return ''
    return v


def label_score(text: str) -> int:
    low = (text or '').lower()
    return sum(1 for t in LABEL_SCORE_TERMS if t in low)


def normalize_lines(text: str):
    lines = []
    for raw in (text or '').replace('\u00a0', ' ').splitlines():
        line = re.sub(r'[ \t]+', ' ', raw).strip()
        if not line:
            continue
        if re.search(r'sulaksh\.online', line, re.I):
            continue
        lines.append(line)

    merged = []
    for line in lines:
        if merged and re.search(r'(?:Name\s+of\s+the|Unique\s+Paper|Name\s+of)$', merged[-1], re.I):
            merged[-1] = merged[-1] + ' ' + line
        else:
            merged.append(line)
    return merged


def extract_label(lines, regex):
    for i, line in enumerate(lines):
        m = regex.match(line)
        if not m:
            continue
        val = clean_value(m.group(1))
        if val:
            return val
        for nxt in lines[i + 1:i + 4]:
            if LABEL_RE.match(nxt):
                break
            if BOILERPLATE_RE.search(nxt):
                continue
            val = clean_value(nxt)
            if val:
                return val
    return ''


def parse_semester(text: str) -> str:
    flat = norm_space(text)
    m = re.search(r'\bSem(?:ester)?\s*[:\-\.]?\s*([IVXLC]+|\d{1,2})\b', flat, re.I)
    if not m:
        return ''
    raw = m.group(1).upper()
    n = int(raw) if raw.isdigit() else ROMAN.get(raw, 0)
    return str(n) if 1 <= n <= 8 else ''


def parse_year(text: str, folder_year: str) -> str:
    if folder_year and folder_year.isdigit() and 2020 <= int(folder_year) <= 2030:
        return folder_year
    flat = norm_space(text)
    m = re.search(r'(?:NOV|DEC|MAY|JUNE|JULY|APRIL|MARCH)[\s\-–—]*(20[12]\d)', flat, re.I)
    if m:
        return m.group(1)
    candidates = [y for y in re.findall(r'\b(20[12]\d)\b', flat) if y != '2026']
    if candidates:
        return max(set(candidates), key=candidates.count)
    return ''


def fallback_title(lines):
    for line in lines:
        if LABEL_RE.match(line) or BOILERPLATE_RE.search(line):
            continue
        if len(line) < 4 or len(line) > 120:
            continue
        letters = sum(c.isalpha() for c in line)
        if letters < 4:
            continue
        if len(line) > 40 and line.count('?') >= 2:
            continue
        return clean_value(line)
    return ''


def parse_metadata(text: str, key: str):
    lines = normalize_lines(text)
    paper = extract_label(lines, PAPER_RE)
    course = extract_label(lines, COURSE_RE)
    if not paper and course:
        paper = course
    subject = paper or course
    if not paper:
        paper = fallback_title(lines)
        subject = subject or paper

    title = paper or ''
    if title and 'pyq' not in title.lower():
        title = title + ' PYQ'
    elif not title:
        title = 'Untitled PYQ'

    folder_year = ''
    m = re.search(r'/pyq/(\d{4})/', key)
    if m:
        folder_year = m.group(1)

    return {
        'k': key,
        't': norm_space(title),
        's': norm_space(subject or ''),
        'c': norm_space(course or ''),
        'm': parse_semester(text),
        'y': parse_year(text, folder_year),
    }


def get_text_layer(doc, max_pages=2):
    chunks = []
    for i in range(min(max_pages, doc.page_count)):
        try:
            chunks.append(doc[i].get_text())
        except Exception:
            pass
    return '\n'.join(chunks)


def ocr_page(page, dpi=150, rotations=4, max_dim=2600):
    pix = page.get_pixmap(dpi=dpi)
    img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
    # Huge scanned pages can make Tesseract crawl; cap the long edge.
    if max_dim and max(img.size) > max_dim:
        scale = max_dim / max(img.size)
        img = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))))
    best_text, best_score = '', -1
    for rot in (0, 90, 180, 270)[:max(1, rotations)]:
        im = img.rotate(-rot, expand=True) if rot else img
        try:
            txt = pytesseract.image_to_string(im, config='--psm 6')
        except Exception:
            continue
        score = label_score(txt)
        if score > best_score:
            best_text, best_score = txt, score
        if score >= 2:
            break
    return best_text


def extract_pdf_text(buf: bytes, dpi=150, max_pages=2, rotations=4, max_dim=2600):
    doc = fitz.open(stream=buf, filetype='pdf')
    try:
        text = get_text_layer(doc, max_pages=max_pages)
        if label_score(text) >= 2:
            return text, 'text'
        all_text = [text]
        best = text
        for i in range(min(max_pages, doc.page_count)):
            t = ocr_page(doc[i], dpi=dpi, rotations=rotations, max_dim=max_dim)
            all_text.append(t)
            if label_score(t) > label_score(best):
                best = t
            if label_score(t) >= 2:
                break
        return '\n'.join(all_text), 'ocr'
    finally:
        doc.close()


def process_one(key, dpi=150, retries=3, max_pages=2, rotations=4, max_dim=2600):
    if not key.startswith('materials/pyq-archive/pyq/'):
        return {'k': key, 'error': 'unexpected key', 'source': 'skip'}
    last_err = ''
    for attempt in range(retries):
        try:
            r = session().get(CDN + key, timeout=90)
            if r.status_code != 200:
                last_err = f'HTTP {r.status_code}'
                time.sleep(1 + attempt * 2)
                continue
            if not r.content.startswith(b'%PDF'):
                last_err = 'not a PDF'
                time.sleep(1 + attempt * 2)
                continue
            text, source = extract_pdf_text(r.content, dpi=dpi, max_pages=max_pages, rotations=rotations, max_dim=max_dim)
            rec = parse_metadata(text, key)
            rec['source'] = source
            return rec
        except Exception as e:
            last_err = f'{type(e).__name__}: {e}'
            time.sleep(1 + attempt * 2)
    return {'k': key, 'error': last_err, 'source': 'failed'}


def load_keys():
    if KEYS_FILE.suffix == '.json':
        data = json.loads(KEYS_FILE.read_text())
        return [o['key'] if isinstance(o, dict) else str(o) for o in data]
    return [line.strip() for line in KEYS_FILE.read_text().splitlines() if line.strip()]


def load_recovered():
    data = json.loads(RECOVERED_FILE.read_text())
    return data if isinstance(data, list) else data.get('rows', [])


def load_done(path: Path):
    done = set()
    if not path.exists():
        return done
    with path.open('r', encoding='utf-8') as f:
        for line in f:
            try:
                rec = json.loads(line)
                if rec.get('k') and not rec.get('error'):
                    done.add(rec['k'])
            except Exception:
                pass
    return done


def sample_keys(keys, n):
    by_year = {}
    for key in keys:
        y = key.split('/')[3] if len(key.split('/')) > 3 else '?'
        by_year.setdefault(y, []).append(key)
    out, i = [], 0
    years = sorted(by_year)
    while len(out) < n:
        added = False
        for y in years:
            arr = by_year[y]
            if i < len(arr):
                out.append(arr[i])
                added = True
                if len(out) >= n:
                    break
        if not added:
            break
        i += 1
    return out


def merge_index(keys, recovered, ocr_path: Path, out_path: Path, base_path: Path = None):
    by_key = {}
    if base_path and base_path.exists():
        try:
            base_rows = json.loads(base_path.read_text())
            for rec in base_rows:
                if rec.get('k'):
                    by_key[rec['k']] = {k: rec.get(k, '') for k in ('k', 't', 's', 'c', 'm', 'y')}
            print(f'base index: {len(by_key)} rows from {base_path}', flush=True)
        except Exception as e:
            print(f'base index skipped ({e})', flush=True)
    recovered_keys = {m.get('k') for m in recovered if m.get('k')}
    for m in recovered:
        key = m.get('k')
        if not key:
            continue
        year = ''
        ym = re.search(r'/pyq/(\d{4})/', key)
        if ym:
            year = ym.group(1)
        title = norm_space(m.get('t') or m.get('title') or '')
        subject = norm_space(m.get('s') or m.get('subject') or '')
        if not title:
            title = subject
        if title and 'pyq' not in title.lower():
            title = title + ' PYQ'
        by_key[key] = {
            'k': key,
            't': title or 'Untitled PYQ',
            's': subject,
            'c': norm_space(m.get('c') or ''),
            'm': norm_space(str(m.get('m') or m.get('semester') or '')),
            'y': str(m.get('y') or m.get('year') or year or ''),
        }
    if ocr_path.exists():
        with ocr_path.open('r', encoding='utf-8') as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                if rec.get('k') and not rec.get('error') and rec['k'] not in recovered_keys:
                    by_key[rec['k']] = {k: rec.get(k, '') for k in ('k', 't', 's', 'c', 'm', 'y')}
    rows = []
    missing = []
    for key in keys:
        rec = by_key.get(key)
        if rec:
            rows.append(rec)
        else:
            missing.append(key)
    rows.sort(key=lambda r: ((r.get('s') or r.get('t') or '').lower(), r.get('t', '')))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'wrote {len(rows)} rows ({out_path.stat().st_size/1024/1024:.2f} MB) to {out_path}', flush=True)
    print(f'missing {len(missing)} keys', flush=True)
    if missing:
        Path('/tmp/archive-missing-keys.txt').write_text('\n'.join(missing) + '\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--sample', type=int, default=0)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--shard-index', type=int, default=0)
    ap.add_argument('--shard-count', type=int, default=1)
    ap.add_argument('--keys-file', type=Path,
                    help='Optional file of specific B2 keys to process (retries)')
    ap.add_argument('--dpi', type=int, default=150)
    ap.add_argument('--max-pages', type=int, default=2,
                    help='PDF pages to inspect/OCR (1 is faster)')
    ap.add_argument('--rotations', type=int, default=4,
                    help='Rotations to try when OCR finds no header (1 is faster)')
    ap.add_argument('--max-dim', type=int, default=2600,
                    help='Cap OCR image long edge in pixels (0 disables)')
    ap.add_argument('--out', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--index', type=Path, default=DEFAULT_INDEX)
    ap.add_argument('--base-index', type=Path,
                    help='Existing index to build on (preserves rows not reprocessed)')
    ap.add_argument('--merge', action='store_true')
    args = ap.parse_args()

    keys = load_keys()
    if args.keys_file:
        keys = [line.strip() for line in args.keys_file.read_text().splitlines() if line.strip()]
    recovered = load_recovered()
    recovered_keys = {m.get('k') for m in recovered if m.get('k')}

    if args.merge:
        merge_index(keys, recovered, args.out, args.index, args.base_index)
        return

    todo = [k for k in keys if k not in recovered_keys]
    if args.sample:
        todo = sample_keys(todo, args.sample)
    elif args.limit:
        todo = todo[:args.limit]
    if args.shard_count > 1:
        todo = [k for i, k in enumerate(todo) if i % args.shard_count == args.shard_index]

    done = load_done(args.out)
    todo = [k for k in todo if k not in done]
    print(f'keys={len(keys)} recovered={len(recovered_keys)} shard={args.shard_index}/{args.shard_count} todo={len(todo)} workers={args.workers}', flush=True)

    started = time.time()
    counts = {'text': 0, 'ocr': 0, 'failed': 0}
    lock = threading.Lock()

    def worker(key):
        rec = process_one(key, dpi=args.dpi, max_pages=args.max_pages, rotations=args.rotations, max_dim=args.max_dim)
        with lock:
            mode = 'a' if args.out.exists() else 'w'
            with args.out.open(mode, encoding='utf-8') as f:
                f.write(json.dumps(rec, ensure_ascii=False) + '\n')
        return rec

    with futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futs = {pool.submit(worker, key): key for key in todo}
        done_n = 0
        for fut in futures.as_completed(futs):
            rec = fut.result()
            done_n += 1
            src = rec.get('source', 'failed')
            counts[src] = counts.get(src, 0) + 1
            if args.sample:
                print(json.dumps(rec, ensure_ascii=False), flush=True)
            if done_n % 10 == 0 or args.sample:
                elapsed = time.time() - started
                rate = done_n / elapsed if elapsed else 0
                eta = (len(todo) - done_n) / rate if rate else 0
                print(
                    f'[{done_n}/{len(todo)}] {rate:.2f}/s eta={eta/60:.1f}m '
                    f'text={counts.get("text",0)} ocr={counts.get("ocr",0)} failed={counts.get("failed",0)} '
                    f'{rec.get("k","")[-50:]} -> {rec.get("t","")[:60]}',
                    flush=True,
                )

    print(f'DONE {counts} in {(time.time()-started)/60:.1f}m', flush=True)


if __name__ == '__main__':
    main()
