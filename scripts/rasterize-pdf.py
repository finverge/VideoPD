"""
Renders a PDF's pages to PNG images for the scanned-PDF OCR fallback (see
src/lib/bankStatement.ts's extractText — this only runs when the PDF's
native text layer came back too short, i.e. a scanned/image-only PDF).

Standalone subprocess, same pattern as scripts/extract-pdf.js (a fresh
one-shot process rather than an in-process import) — for the same reason:
this is invoked from a long-lived Next.js dev server, and a one-shot
process sidesteps any state-corruption-across-calls risk a long-lived
import might have, matching extract-pdf.js's own documented rationale.

Uses PyMuPDF (pymupdf, real, installed on system Python — confirmed
present in this environment; a pip-installable prebuilt wheel on Windows,
no native compiler needed, unlike node-canvas which is what pdfjs-dist
would otherwise require for server-side rendering).

Usage: python rasterize-pdf.py <pdf_path> <output_dir> [max_pages]
Prints JSON to stdout: {"pageCount": N, "renderedPages": M, "files": [...]}
"""
import sys
import os
import json

import pymupdf

DEFAULT_MAX_PAGES = 15
DPI = 200  # good balance for Tesseract OCR accuracy vs. render/OCR time


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: rasterize-pdf.py <pdf_path> <output_dir> [max_pages]"}), file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    max_pages = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_MAX_PAGES

    os.makedirs(output_dir, exist_ok=True)

    try:
        doc = pymupdf.open(pdf_path)
    except Exception as e:
        print(json.dumps({"error": f"Could not open PDF: {e}"}), file=sys.stderr)
        sys.exit(1)

    page_count = doc.page_count
    pages_to_render = min(page_count, max_pages)
    files = []
    zoom = DPI / 72.0  # PyMuPDF's default render is 72 DPI; scale up for OCR quality
    matrix = pymupdf.Matrix(zoom, zoom)

    for i in range(pages_to_render):
        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=matrix)
        out_path = os.path.join(output_dir, f"page-{i + 1}.png")
        pix.save(out_path)
        files.append(out_path)

    doc.close()
    print(json.dumps({"pageCount": page_count, "renderedPages": len(files), "files": files}))


if __name__ == "__main__":
    main()
