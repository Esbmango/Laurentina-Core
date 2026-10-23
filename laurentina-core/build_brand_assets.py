"""Convert the approved V1 mark and code-native desktop tile to icon sizes.

Run with a Python environment containing Pillow. Output paths are fixed inside
this project. The original PNG remains byte-for-byte intact. Background removal
is performed separately with image_gen, never with this conversion script.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parent
SIZES = (16, 24, 32, 48, 64, 128, 256)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(source, mark, desktop):
    from PIL import Image
    source = Path(source).resolve(strict=True)
    mark = Path(mark).resolve(strict=True)
    desktop = Path(desktop).resolve(strict=True)
    original = ROOT / "assets/logo-v1-original.png"
    icon_png, icon_ico = ROOT / "assets/icon.png", ROOT / "assets/icon.ico"
    ui_png = ROOT / "ui/logo-v1.png"
    with Image.open(source) as loaded:
        if loaded.format != "PNG" or loaded.width != loaded.height:
            raise ValueError("The source must be the square, original PNG; no crop or background changes are applied.")
        loaded.load()
        source_size, source_mode = loaded.size, loaded.mode
    source_sha = sha(source)
    original.parent.mkdir(exist_ok=True)
    if original.exists() and sha(original) != source_sha:
        raise ValueError('The archived V1 original is immutable; use a new logo version for a different source.')
    if not original.exists():
        shutil.copyfile(source, original)
    assert sha(original) == source_sha, "Original logo bytes must remain unchanged"
    with Image.open(mark) as loaded:
        if loaded.format != 'PNG' or loaded.width != loaded.height or loaded.mode != 'RGBA':
            raise ValueError('Use the approved square RGBA transparent mark from image_gen.')
        loaded.load()
        image = loaded.copy()
    if image.getchannel('A').getextrema() != (0, 255):
        raise ValueError('The approved mark must retain genuine transparent and opaque pixels.')
    stored_mark = ROOT / 'assets/logo-v1-mark.png'
    if mark != stored_mark.resolve():
        shutil.copyfile(mark, stored_mark)
    # Preserve the generated alpha exactly apart from ordinary size resampling.
    ui_image = image.resize((512, 512), Image.Resampling.LANCZOS)
    ui_image.save(ui_png, format="PNG", optimize=True)
    with Image.open(desktop) as loaded:
        if loaded.format != 'PNG' or loaded.mode != 'RGBA' or loaded.size != (512, 512):
            raise ValueError('Render the desktop SVG with render_brand_icon.cjs first.')
        loaded.load()
        resized = loaded.copy()
    resized.save(icon_png, format="PNG", optimize=True)
    resized.save(icon_ico, format="ICO", sizes=[(size, size) for size in SIZES])
    shutil.copyfile(icon_ico, ROOT / 'assets/logo-v1-desktop.ico')
    # Retain the old SVG entry point as a raster wrapper, not a traced/redrawn
    # approximation. No application code currently depends on this SVG.
    (ROOT / "assets/icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
        '<image href="icon.png" width="512" height="512" preserveAspectRatio="xMidYMid meet"/></svg>\n', encoding="utf-8")
    with Image.open(icon_png) as check:
        assert check.size == (512, 512) and check.convert('RGBA').tobytes() == resized.tobytes()
    with Image.open(icon_ico) as check:
        assert check.ico.sizes() == {(size, size) for size in SIZES}
    manifest = {"name": "Laurentina", "logo_version": "V1", "source_name": source.name,
                "original": {"path": "assets/logo-v1-original.png", "size": list(source_size), "mode": source_mode,
                             "bytes": original.stat().st_size, "sha256": source_sha},
                "cutout": {"path": "assets/logo-v1-mark.png", "size": list(image.size), "mode": image.mode,
                           "sha256": sha(mark), "method": "built-in image_gen background-extraction",
                           "prompt_path": "assets/logo-v1-edit-prompt.txt"},
                "desktop": {"path": "assets/logo-v1-desktop.png", "sha256": sha(desktop),
                            "source_svg": "assets/logo-v1-desktop.svg",
                            "method": "code-native rounded app tile using the approved transparent mark"},
                "png": {"path": "assets/icon.png", "size": [512, 512], "sha256": sha(icon_png)},
                "ui_png": {"path": "ui/logo-v1.png", "sha256": sha(ui_png)},
                "ico": {"path": "assets/icon.ico", "sizes": list(SIZES), "sha256": sha(icon_ico)},
                "transform": "image_gen mark extraction; code-native desktop app tile; standard size and format conversion; original source preserved"}
    (ROOT / "assets/logo-v1.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "passed", "original_sha256": source_sha, "png": [512, 512], "ico_sizes": SIZES}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "assets/logo-v1-original.png")
    parser.add_argument("--mark", type=Path, default=ROOT / "assets/logo-v1-mark.png")
    parser.add_argument("--desktop", type=Path, default=ROOT / "assets/logo-v1-desktop.png")
    args = parser.parse_args()
    build(args.source, args.mark, args.desktop)
