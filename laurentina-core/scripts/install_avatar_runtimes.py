"""Install optional pinned SDK runtimes separately from the public source tree."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
from urllib.request import Request, urlopen
import zipfile

CORE = Path(__file__).resolve().parent.parent
MAX_DOWNLOAD = 32 * 1024 * 1024


def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": "Laurentina-Optional-SDK-Setup/0.9.1"}), timeout=60) as response:
        data = response.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise RuntimeError("SDK download exceeded the size limit")
    return data


def checked(data, digest):
    if hashlib.sha256(data).hexdigest() != digest:
        raise RuntimeError("SDK checksum mismatch; no file was installed")
    return data


def install(core=CORE, kind="spine"):
    core = Path(core)
    lock = json.loads((core / "assets/vendor/avatar-runtimes.json").read_text(encoding="utf-8"))
    selected = [item for item in lock["runtimes"] if
                (kind in ("spine", "all") and "spine-player" in item["file"]) or
                (kind in ("live2d", "all") and "spine-player" not in item["file"])]
    results = []
    for item in selected:
        destination = core / item["file"]
        if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest() == item["sha256"]:
            results.append({"file": item["file"], "status": "already verified"})
            continue
        raw = fetch(item["source"])
        if "source_archive_sha256" in item:
            checked(raw, item["source_archive_sha256"])
            npm = shutil.which("npm.cmd") or shutil.which("npm")
            if not npm:
                raise RuntimeError("Install Node.js and npm before building the optional Cubism Framework")
            with tempfile.TemporaryDirectory(prefix="laurentina-cubism-") as temporary:
                build = Path(temporary)
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    # Extract only framework TS/declarations; never execute archive installers.
                    for entry in archive.infolist():
                        relative = Path(entry.filename)
                        if (relative.is_absolute() or ".." in relative.parts or len(relative.parts) < 2 or entry.is_dir()):
                            continue
                        if not (relative.parts[1] == "src" or (len(relative.parts) == 2 and relative.name == "tsconfig.json")):
                            continue
                        if not entry.filename.endswith((".ts", ".json")):
                            continue
                        target = build / "framework" / relative
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(archive.read(entry))
                declaration = ('declare namespace Live2DCubismCore { const Version:any; const Logging:any; '
                               'const Memory:any; const Moc:any; const Model:any; const Utils:any; }\n')
                (build / "cubism-core.d.ts").write_text(declaration, encoding="utf-8")
                entry = build / "cubism-entry.ts"
                entry.write_text("\n".join(item["exports"]) + "\n", encoding="utf-8")
                output = build / "bundle.js"
                subprocess.run([npm, "exec", "--yes", "--package=esbuild@" + item["build_tool"], "--",
                                "esbuild", str(entry), "--bundle", "--format=iife",
                                "--global-name=LaurentinaCubism", "--minify", "--outfile=" + str(output)],
                               cwd=build, check=True, timeout=180)
                data = output.read_bytes()
        elif item["source"].endswith(".tgz"):
            with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
                member = archive.getmember("package/dist/iife/spine-player.min.js")
                if not member.isfile() or member.size > MAX_DOWNLOAD:
                    raise RuntimeError("Unexpected Spine runtime archive")
                data = archive.extractfile(member).read(MAX_DOWNLOAD + 1)
        else:
            data = raw
        checked(data, item["sha256"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".part")
        try:
            temporary.write_bytes(data)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        results.append({"file": item["file"], "status": "installed and verified"})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=("spine", "live2d", "all"), required=True)
    args = parser.parse_args()
    for result in install(kind=args.kind):
        print(result["status"] + ": " + result["file"])


if __name__ == "__main__":
    main()
