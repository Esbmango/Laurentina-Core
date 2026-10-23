"""Build an ad-hoc signed Mac preview from audited sources and pinned runtimes.

Run on the target Mac architecture after npm ci. No models or private data are
included. The resulting application contains its own base Python dependencies.
Developer ID signing/notarization is a separate release operation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
from urllib.request import Request, urlopen

from pack_release import collect, audit

CORE = Path(__file__).resolve().parent.parent
MAX_RUNTIME_BYTES = 150 * 1024 * 1024


def runtime_artifact(core, arch):
    lock = json.loads((core / 'assets/vendor/python-runtime.json').read_text(encoding='utf-8'))
    value = lock['artifacts'].get(arch)
    if not value or len(value.get('sha256', '')) != 64 or not value['url'].startswith(
            'https://github.com/astral-sh/python-build-standalone/releases/download/'):
        raise ValueError('No pinned standalone Python for this Mac architecture')
    return value


def download_runtime(artifact, destination):
    digest, size = hashlib.sha256(), 0
    request = Request(artifact['url'], headers={'User-Agent': 'Laurentina-Mac-build'})
    with urlopen(request, timeout=90) as response, destination.open('xb') as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_RUNTIME_BYTES:
                raise ValueError('Standalone Python archive exceeded the download bound')
            digest.update(chunk)
            output.write(chunk)
    if digest.hexdigest() != artifact['sha256']:
        raise ValueError('Standalone Python archive hash mismatch')


def copy_sources(core, resources):
    files, _ = collect(core)
    copied = []
    for relative, source in files.items():
        rel = Path(relative)
        if rel.parts[0] == core.name:
            destination = resources / 'app' / Path(*rel.parts[1:])
        elif rel.parts[0] == 'hy-memory-starter':
            destination = resources / rel
        elif rel.parts[0] == 'docs':
            destination = resources / rel
        else:
            continue
        audit(source, rel)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        copied.append(relative)
    return copied


def icon(core, resources, temporary):
    iconset = temporary / 'Laurentina.iconset'
    iconset.mkdir()
    source = core / 'assets/icon.png'
    for pixels in (16, 32, 128, 256, 512):
        for retina in (False, True):
            filename = f'icon_{pixels}x{pixels}' + ('@2x' if retina else '') + '.png'
            size = pixels * (2 if retina else 1)
            subprocess.run(['sips', '-z', str(size), str(size), str(source), '--out', str(iconset / filename)],
                           check=True, capture_output=True)
    subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(resources / 'laurentina.icns')], check=True)


def sign_application(application, entitlements):
    # Sign nested code from the inside out. --deep is for verification only.
    macho = {b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xcf\xfa\xed\xfe',
             b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}
    containers = []
    for file in application.rglob('*'):
        if file.is_symlink():
            continue
        if file.is_dir():
            if file.suffix in ('.app', '.framework', '.xpc', '.bundle'):
                containers.append(file)
            continue
        if file.is_file():
            with file.open('rb') as source:
                header = source.read(4)
            if header in macho:
                subprocess.run(['codesign', '--force', '--sign', '-', str(file)], check=True)
    for container in sorted(containers, key=lambda item: len(item.parts), reverse=True) + [application]:
        args = ['codesign', '--force', '--sign', '-']
        if container.suffix == '.app':
            args += ['--entitlements', str(entitlements)]
        subprocess.run(args + [str(container)], check=True)


def build(output, core=CORE, make_dmg=True):
    if sys.platform != 'darwin':
        raise RuntimeError('Build the Mac application on a Mac or the macOS CI runner')
    core, output = Path(core).resolve(), Path(output).expanduser().resolve()
    if output.exists() or output.is_relative_to(core.parent) or core.parent.is_relative_to(output):
        raise ValueError('Choose a fresh build directory outside the source workspace')
    arch = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'x64'}.get(platform.machine())
    artifact = runtime_artifact(core, arch)
    electron = core / 'node_modules/electron/dist/Electron.app'
    if not electron.is_dir():
        raise RuntimeError('Run npm ci on this Mac architecture before building')
    version = json.loads((core / 'package.json').read_text(encoding='utf-8'))['version']
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.Laurentina-mac-', dir=output.parent) as work:
        temporary = Path(work)
        application = temporary / 'Laurentina.app'
        shutil.copytree(electron, application, symlinks=True)
        resources = application / 'Contents/Resources'
        # Remove the default Electron shell to prevent loading it on a failed copy.
        (resources / 'default_app.asar').unlink(missing_ok=True)
        copied = copy_sources(core, resources)
        archive = temporary / 'python.tar.gz'
        download_runtime(artifact, archive)
        with tarfile.open(archive, 'r:gz') as packed:
            packed.extractall(resources, filter='data')
        python = resources / 'python/bin/python3'
        memory = resources / 'hy-memory-starter'
        subprocess.run([str(python), '-E', '-s', '-m', 'pip', 'install', '--disable-pip-version-check',
                        '--no-cache-dir', '-c', str(memory / 'requirements.lock.txt'),
                        '-r', str(memory / 'requirements.txt'), '-r', str(resources / 'app/requirements.txt')], check=True)
        subprocess.run([str(python), '-E', '-s', '-m', 'pip', 'check'], check=True)
        # Installed Python children may be launched by plugins rather than the
        # main entry. Keep all of them from modifying a signed application.
        site = resources / 'python/lib/python3.12/site-packages/sitecustomize.py'
        if site.exists():
            raise RuntimeError('Unexpected bundled sitecustomize; inspect the runtime')
        site.write_text('import sys\nsys.dont_write_bytecode = True\n', encoding='utf-8')
        subprocess.run([str(python), '-B', '-m', 'compileall', '-q', '-x', r'[/\\](?:site-packages|test)[/\\]',
                        str(resources / 'app'), str(memory), str(resources / 'python/lib/python3.12')], check=True)
        subprocess.run([str(python), '-B', '-m', 'py_compile', str(site)], check=True)
        metadata_path = application / 'Contents/Info.plist'
        metadata = plistlib.loads(metadata_path.read_bytes())
        metadata.update({
            'CFBundleName': 'Laurentina', 'CFBundleDisplayName': 'Laurentina',
            'CFBundleIdentifier': 'app.laurentina.core', 'CFBundleShortVersionString': version,
            'CFBundleVersion': version, 'CFBundleIconFile': 'laurentina.icns',
            'NSMicrophoneUsageDescription': 'Laurentina uses the microphone only when you start voice input. / 劳纶缇娜仅在你开启语音输入时使用麦克风。',
            'NSHighResolutionCapable': True,
            'LSMinimumSystemVersion': '15.0',
        })
        metadata_path.write_bytes(plistlib.dumps(metadata))
        icon(core, resources, temporary)
        notices = resources / 'third-party-notices'
        notices.mkdir()
        shutil.copyfile(resources / 'python/lib/python3.12/LICENSE.txt', notices / 'CPython-LICENSE.txt')
        dist = electron.parent
        for filename in ('LICENSE', 'LICENSES.chromium.html'):
            source = dist / filename
            if source.is_file():
                shutil.copyfile(source, notices / filename)
        (resources / 'build-info.json').write_text(json.dumps({
            'version': version, 'architecture': arch, 'kind': 'macOS-ad-hoc-preview',
            'python_archive_sha256': artifact['sha256'], 'source_files': copied,
            'models_included': False, 'personal_data_included': False,
        }, indent=2), encoding='utf-8')
        sign_application(application, core / 'scripts/macos/entitlements.plist')
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(application)], check=True)
        output.mkdir()
        shutil.move(str(application), str(output / application.name))
    application = output / 'Laurentina.app'
    zipped = output / f'Laurentina-v{version}-macOS-{arch}-preview.zip'
    subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(application), str(zipped)], check=True)
    artifacts = [zipped]
    if make_dmg:
        dmg = output / f'Laurentina-v{version}-macOS-{arch}-preview.dmg'
        with tempfile.TemporaryDirectory(prefix='.Laurentina-dmg-', dir=output.parent) as stage:
            stage = Path(stage)
            shutil.copytree(application, stage / application.name, symlinks=True)
            (stage / 'Applications').symlink_to('/Applications')
            (stage / 'READ-ME.txt').write_text(
                'Laurentina macOS preview: drag the app to Applications.\n'
                'This preview is ad-hoc signed, not Apple Developer ID notarized.\n'
                'Use Finder > Open if Gatekeeper requests confirmation. No models are included.\n'
                'macOS 预览：将应用拖入 Applications；预览版尚未经 Apple 公证。\n', encoding='utf-8')
            subprocess.run(['hdiutil', 'create', '-volname', 'Laurentina', '-srcfolder', str(stage),
                            '-ov', '-format', 'UDZO', str(dmg)], check=True)
        artifacts.append(dmg)
    report = {'application': str(application), 'version': version, 'architecture': arch,
              'artifacts': [{'file': str(item), 'bytes': item.stat().st_size,
                             'sha256': hashlib.sha256(item.read_bytes()).hexdigest()} for item in artifacts]}
    (output / 'build-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--no-dmg', action='store_true')
    args = parser.parse_args()
    print(json.dumps(build(args.output, make_dmg=not args.no_dmg), indent=2))
