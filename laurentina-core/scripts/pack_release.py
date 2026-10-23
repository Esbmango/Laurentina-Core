"""Build an allowlisted source release outside the live workspace; never upload."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import tempfile
import zipfile

CORE = Path(__file__).resolve().parent.parent
BLOCKED = {".local", ".runtime", ".venv", ".voice-venv", ".custom-voice-venv", "node_modules", "__pycache__", ".git", "sources"}
TEXT = {".py", ".pyw", ".cjs", ".js", ".json", ".md", ".txt", ".html", ".css", ".cmd", ".command", ".sh", ".plist", ".ps1", ".yaml", ".yml", ".svg", ".example"}
PRIVATE = [
    ("personal absolute path", re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+(?!<|YOUR_|your-)[^\s\"'<>]+", re.I)),
    ("personal Mac home path", re.compile(r"/Users/(?!YOUR_|your-)[A-Za-z0-9_.-]+(?:/|$)", re.I)),
    ("synced project identity", re.compile(r"g-p-[a-f0-9]{20,}", re.I)),
    ("credential-shaped token", re.compile(r"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,})\b")),
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
]


def audit(path, relative):
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Release target must be a contained relative path")
    if any(part.lower() in BLOCKED for part in relative.parts):
        raise ValueError("Forbidden release path: " + relative.as_posix())
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        raise ValueError("Links/junctions are not publishable: " + relative.as_posix())
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("Unexpected large source asset: " + relative.as_posix())
    if path.suffix.lower() in TEXT or path.name == ".gitignore":
        text = path.read_text(encoding="utf-8-sig")
        for label, pattern in PRIVATE:
            if pattern.search(text):
                raise ValueError(label + " found in " + relative.as_posix() + "; inspect locally before publishing")


def collect(core=CORE):
    core = Path(core).resolve()
    manifest = json.loads((core / "scripts/release_manifest.json").read_text(encoding="utf-8"))
    files = {}
    for folder, patterns in ((core, manifest["core"]), (core.parent / "hy-memory-starter", manifest["memory"])):
        for pattern in patterns:
            for source in sorted(folder.glob(pattern)):
                if not source.is_file():
                    continue
                relative = Path(folder.name) / source.relative_to(folder)
                # A source parent junction can otherwise escape a benign allowlist.
                if (not source.resolve().is_relative_to(folder.resolve()) or
                        any(parent.is_symlink() or getattr(parent, "is_junction", lambda: False)()
                            for parent in source.parents if parent != folder and parent.is_relative_to(folder))):
                    raise ValueError("Allowlist path escaped its source directory")
                audit(source, relative)
                files[relative.as_posix()] = source
    for target, source in manifest["root_files"].items():
        audit(core / source, Path(target))
        files[target] = core / source
    for source in (core / "docs").glob("*.md"):
        files["docs/" + source.name] = source
    files["hy-memory-starter/README.md"] = core / "docs/HYMEMORY.md"
    files["hy-memory-starter/.gitignore"] = core / ".gitignore"
    return files, manifest


def build(output, core=CORE, create_zip=True):
    core = Path(core).resolve()
    output = Path(output).expanduser().resolve()
    workspace = core.parent
    if output.is_relative_to(workspace) or workspace.is_relative_to(output):
        raise ValueError("Release destination must be outside, and not contain, the live workspace")
    if output.exists() or Path(str(output) + ".zip").exists():
        raise ValueError("Release destination already exists; use a fresh directory")
    files, rules = collect(core)
    for relative, source in files.items():
        audit(source, Path(relative))
    version = json.loads((core / "package.json").read_text(encoding="utf-8"))["version"]
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".LaurentinaCore-stage-", dir=output.parent))
    archive_path = None
    try:
        entries = []
        for relative, source in sorted(files.items()):
            target = temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            audit(target, Path(relative))
            entries.append({"path": relative, "bytes": target.stat().st_size,
                            "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
        release = {"schema": 1, "project": "LaurentinaCore", "version": version,
                   "created_at": datetime.now(timezone.utc).isoformat(),
                   "kind": "source", "includes_private_data": False,
                   "sdk_runtimes_included": False, "excluded": rules["excluded"], "files": entries}
        (temporary / "RELEASE-MANIFEST.json").write_text(json.dumps(release, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(output)
        if create_zip:
            archive_path = Path(str(output) + ".zip")
            with zipfile.ZipFile(archive_path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for source in sorted(output.rglob("*")):
                    if source.is_file():
                        member = Path(output.name) / source.relative_to(output)
                        if source.suffix in ('.command', '.sh'):
                            info = zipfile.ZipInfo.from_file(source, member.as_posix())
                            info.create_system = 3
                            info.external_attr = (stat.S_IFREG | 0o755) << 16
                            info.compress_type = zipfile.ZIP_DEFLATED
                            archive.writestr(info, source.read_bytes())
                        else:
                            archive.write(source, member)
        return {"directory": str(output), "archive": str(archive_path) if archive_path else None,
                "version": version, "files": len(entries), "bytes": sum(item["bytes"] for item in entries)}
    except BaseException:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--no-zip", action="store_true")
    parser.add_argument("--list", action="store_true", help="Audit and print allowlisted relative paths without copying")
    args = parser.parse_args()
    if args.list:
        files, _ = collect()
        print("\n".join(sorted(files)))
        return
    version = json.loads((CORE / "package.json").read_text(encoding="utf-8"))["version"]
    default = Path.home() / ".codex/releases" / ("LaurentinaCore-" + version + "-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    print(json.dumps(build(args.output or default, create_zip=not args.no_zip), indent=2))


if __name__ == "__main__":
    main()
