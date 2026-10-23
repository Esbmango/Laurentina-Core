"""Install optional, isolated local reference-voice synthesis from pinned sources."""
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import venv

ROOT = Path(__file__).resolve().parent
MODEL_REPO = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
MODEL_REVISION = "5d83992436eae1d760afd27aff78a71d676296fc"
SOURCE_REPO = "QwenLM/Qwen3-TTS"
SOURCE_REVISION = "022e286b98fbec7e1e916cb940cdf532cd9f488e"
ACCELERATOR_REPO = "andimarafioti/faster-qwen3-tts"
ACCELERATOR_REVISION = "a70afc0f81f7f5f8801c3227968f1102f43f211c"
MODEL_PATH = ROOT / ".local" / "models" / "qwen3-tts-0.6b-base"
MODEL_FILES = {
    "README.md": (3640, "50931da8c9b34f7233394b5c3063a47ef3285acf"),
    "config.json": (4494, "4e923f500f5c3eeb78d44072e7049b28817c2e04"),
    "generation_config.json": (245, "1872b16d4535564abf2db5d6debe6cddd82b7f2e"),
    "merges.txt": (1671839, "20024bfe7c83998e9aeaf98a0cd6a2ce6306c2f0"),
    "model.safetensors": (1829344272, "180b3b10eb1c9f1b4db7806d5475bae3071c0243c299d49926bab1da3b6946f6"),
    "preprocessor_config.json": (127, "0525dd953bb9241912f7147666f0d535165d5d4f"),
    "speech_tokenizer/config.json": (2336, "06cc8dc4c5ec8a1929086b71b98c313020d9268b"),
    "speech_tokenizer/configuration.json": (76, "ab58e2eaf53cd14a1a2a7527d9261ceea93a24cd"),
    "speech_tokenizer/model.safetensors": (682293092, "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258"),
    "speech_tokenizer/preprocessor_config.json": (234, "ba40914f4f49ab98a8ca545d4892ef7291a39592"),
    "tokenizer_config.json": (7344, "6ff9fd60cc623bb54bbd603cbd418c97a11528d7"),
    "vocab.json": (2776833, "4783fe10ac3adce15ac8f358ef5462739852c569"),
}


def digest_file(path, git_blob=False):
    digest = hashlib.sha1() if git_blob else hashlib.sha256()
    if git_blob:
        digest.update(f"blob {path.stat().st_size}\0".encode("ascii"))
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_file(item, verify_only=False):
    relative, (size, expected) = item
    destination = MODEL_PATH / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    def valid(path):
        return path.is_file() and path.stat().st_size == size and digest_file(path, len(expected) == 40) == expected
    if not valid(destination):
        if verify_only:
            raise RuntimeError(f"Missing or mismatched model file: {relative}")
        temporary = destination.with_suffix(destination.suffix + ".part")
        url = f"https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{relative}?download=true"
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Laurentina-Core/0.6"}), timeout=120) as response, temporary.open("wb") as stream:
            shutil.copyfileobj(response, stream, length=1024 * 1024)
        if not valid(temporary):
            raise RuntimeError(f"Model checksum mismatch: {relative}")
        temporary.replace(destination)
    print(f"Verified {relative}", flush=True)
    return {"file": relative, "bytes": size, "sha256": digest_file(destination)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-only", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if not args.verify_only and shutil.disk_usage(ROOT).free < 12 * 1024 ** 3:
        raise RuntimeError("At least 12 GB of free disk space is required for the isolated runtime and model")
    if not args.models_only and not args.verify_only:
        environment = ROOT / ".custom-voice-venv"
        python = environment / "Scripts" / "python.exe"
        if not python.is_file():
            venv.EnvBuilder(with_pip=True).create(environment)
        subprocess.run([str(python), "-m", "pip", "install", "torch==2.8.0", "torchaudio==2.8.0", "--index-url", "https://download.pytorch.org/whl/cu128"], check=True)
        subprocess.run([str(python), "-m", "pip", "install", "-r", str(ROOT / "requirements-custom-voice.txt")], check=True)
        subprocess.run([str(python), "-m", "pip", "install", "--no-deps", "--require-hashes", "-r", str(ROOT / "requirements-custom-voice-runtime.txt")], check=True)
        freeze = subprocess.run([str(python), "-m", "pip", "freeze"], check=True, capture_output=True, text=True)
        (ROOT / ".local" / "custom-voice-installed.txt").write_text(freeze.stdout, encoding="utf-8")
    with ThreadPoolExecutor(max_workers=3) as pool:
        files = list(pool.map(lambda item: fetch_file(item, args.verify_only), MODEL_FILES.items()))
    if not args.verify_only:
        license_dir = ROOT / "assets" / "licenses"
        license_dir.mkdir(parents=True, exist_ok=True)
        url = f"https://raw.githubusercontent.com/{SOURCE_REPO}/{SOURCE_REVISION}/LICENSE"
        with urllib.request.urlopen(url, timeout=30) as response:
            (license_dir / "Qwen3-TTS-APACHE-2.0.txt").write_bytes(response.read(50000))
        url = f"https://raw.githubusercontent.com/{ACCELERATOR_REPO}/{ACCELERATOR_REVISION}/LICENSE"
        with urllib.request.urlopen(url, timeout=30) as response:
            (license_dir / "Faster-Qwen3-TTS-MIT.txt").write_bytes(response.read(50000))
        (MODEL_PATH / "manifest.json").write_text(json.dumps({"repository": MODEL_REPO, "revision": MODEL_REVISION,
            "runtime": "qwen-tts==0.1.1", "source_repository": SOURCE_REPO, "source_revision": SOURCE_REVISION,
            "accelerator": "faster-qwen3-tts==0.3.2", "accelerator_repository": ACCELERATOR_REPO, "accelerator_revision": ACCELERATOR_REVISION,
            "files": files}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Local reference-voice setup complete. No account or cloud service is required.", flush=True)


if __name__ == "__main__":
    main()
