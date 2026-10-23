"""Deliver one verified native CI build to its existing source Release.

Standard library only. No tag/Release creation, deletion, Git operations, or
asset replacement. The workflow downloads artifacts; this script checks them
and sends only two preview archives plus their relative checksum manifest.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

OWNER = "Esbmango"
NAME = "Laurentina-Core"
REPO = f"/repos/{OWNER}/{NAME}"
FULL_NAME = f"{OWNER}/{NAME}"
VERSION = "0.10.0"
TAG = "v" + VERSION
RUN = 39987100186
COMMIT = "501db7af4da5ae8e02ecafc7feee5c56fbbad378"
ARTIFACT_NAME = "Laurentina-macOS-arm64-preview"
SOURCE = "Laurentina-Core-v0.10.0-source.zip"
SOURCE_BYTES = 2008447
SOURCE_SHA256 = "398e795ef0c5a64aaf50a2dd7963465edb33d5a7272f87b3236d3446cba93d3c"
STEM = f"Laurentina-v{VERSION}-macOS-arm64-preview"
PREVIEWS = {STEM + ".zip", STEM + ".dmg"}
KNOWN = PREVIEWS | {"build-report.json", "smoke-report.json", "smoke-report.png"}
CHUNK = 1024 * 1024
MAX_BYTES = 1_500_000_000
HEX = re.compile(r"[a-f0-9]{64}\Z")


class DeliveryError(RuntimeError):
    pass


def require(value, message):
    if not value:
        raise DeliveryError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate JSON field")
            result[key] = value
        return result
    try:
        return json.loads(data, object_pairs_hook=unique)
    except (ValueError, UnicodeError):
        raise DeliveryError("Invalid JSON data") from None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


class GitHub:
    def __init__(self, token):
        require(isinstance(token, str) and token, "GITHUB_TOKEN is unavailable")
        self.token = token
        self.opener = build_opener(NoRedirect)

    def headers(self):
        return {"Authorization": "Bearer " + self.token,
                "Accept": "application/vnd.github+json", "User-Agent": "Laurentina-CI-delivery",
                "X-GitHub-Api-Version": "2022-11-28"}

    def api(self, path):
        require(path.startswith("/") and not path.startswith("//"), "Invalid GitHub API path")
        try:
            with self.opener.open(Request("https://api.github.com" + path, headers=self.headers()), timeout=90) as response:
                data = response.read(4 * CHUNK + 1)
                require(len(data) <= 4 * CHUNK, "GitHub JSON response exceeded limit")
                return read_json(data)
        except HTTPError as error:
            status = error.code
            error.close()
            raise DeliveryError(f"GitHub API status {status}") from None
        except (OSError, URLError):
            raise DeliveryError("GitHub API request failed") from None

    def upload(self, release, path):
        endpoint = release.get("upload_url", "").split("{")[0]
        parsed = urlsplit(endpoint)
        expected = REPO + f"/releases/{release['id']}/assets"
        require(parsed.scheme == "https" and parsed.hostname == "uploads.github.com" and
                parsed.port in (None, 443) and not parsed.username and not parsed.password and
                parsed.path == expected and not parsed.query and not parsed.fragment,
                "Unexpected Release upload endpoint")
        headers = {**self.headers(), "Content-Type": "application/octet-stream",
                   "Content-Length": str(path.stat().st_size)}
        connection = http.client.HTTPSConnection("uploads.github.com", timeout=300)
        try:
            with path.open("rb") as stream:
                connection.request("POST", expected + "?" + urlencode({"name": path.name}),
                                   body=stream, headers=headers)
                response = connection.getresponse()
                data = response.read(4 * CHUNK + 1)
                require(response.status == 201, f"Release upload HTTP status {response.status}")
                require(len(data) <= 4 * CHUNK, "Upload JSON response exceeded limit")
                return read_json(data)
        except (OSError, http.client.HTTPException):
            raise DeliveryError("Release upload failed; existing assets were not deleted") from None
        finally:
            connection.close()


def verify_run(client):
    repository = client.api(REPO)
    require(repository.get("owner", {}).get("login", "").lower() == OWNER.lower() and
            repository.get("full_name", "").lower() == FULL_NAME.lower(), "Unexpected repository owner")
    run = client.api(REPO + f"/actions/runs/{RUN}")
    require(run.get("id") == RUN and run.get("status") == "completed" and
            run.get("conclusion") == "success" and run.get("head_sha") == COMMIT and
            run.get("head_branch") == "main" and
            run.get("repository", {}).get("full_name", "").lower() == FULL_NAME.lower(),
            "Original native CI run is not the expected successful main commit")
    require(client.api(REPO + "/commits/main").get("sha") == COMMIT,
            "Main changed after the verified native build")
    artifacts = client.api(REPO + f"/actions/runs/{RUN}/artifacts?per_page=100").get("artifacts", [])
    matches = [item for item in artifacts if item.get("name") == ARTIFACT_NAME]
    require(len(matches) == 1 and matches[0].get("expired") is False and
            matches[0].get("workflow_run", {}).get("id") == RUN,
            "Expected native artifact is absent, expired or ambiguous")


def verify_release(client):
    release = client.api(REPO + "/releases/tags/" + quote(TAG, safe=""))
    require(release.get("tag_name") == TAG and release.get("draft") is False,
            "Existing published source Release is required")
    sources = [item for item in release.get("assets", []) if item.get("name") == SOURCE]
    require(len(sources) == 1 and sources[0].get("state") == "uploaded" and
            sources[0].get("size") == SOURCE_BYTES and
            sources[0].get("digest") == "sha256:" + SOURCE_SHA256,
            "Source Release ZIP differs from the audited source archive")
    obj = client.api(REPO + "/git/ref/tags/" + TAG)["object"]
    for _ in range(5):
        if obj.get("type") == "commit":
            break
        require(obj.get("type") == "tag" and re.fullmatch(r"[a-f0-9]{40}", obj.get("sha", "")),
                "Unexpected Release tag object")
        obj = client.api(REPO + "/git/tags/" + obj["sha"])["object"]
    require(obj.get("type") == "commit" and obj.get("sha") == COMMIT,
            "Source Release tag differs from the verified CI commit")
    return release


def verify_files(directory):
    require(directory.is_dir() and not directory.is_symlink(), "Artifact directory is unavailable or linked")
    files = list(directory.iterdir())
    require({path.name for path in files} == KNOWN and len(files) == len(KNOWN) and
            all(path.is_file() and not path.is_symlink() for path in files),
            "Expected exactly five regular native artifact output files")
    require(sum(path.stat().st_size for path in files) <= MAX_BYTES, "Native artifacts exceeded size bound")
    for name in ("build-report.json", "smoke-report.json"):
        require(0 < (directory / name).stat().st_size <= CHUNK, "Unexpected report size")
    require(0 < (directory / "smoke-report.png").stat().st_size <= 25 * CHUNK, "Unexpected screenshot size")
    build = read_json((directory / "build-report.json").read_bytes())
    smoke = read_json((directory / "smoke-report.json").read_bytes())
    require(build.get("version") == VERSION and build.get("architecture") == "arm64",
            "Native build version or architecture mismatch")
    checks = smoke.get("checks", {})
    require(smoke.get("ok") is True and smoke.get("platform") == "darwin" and
            smoke.get("arch") == "arm64" and checks.get("version") == VERSION,
            "Native smoke result, version or architecture mismatch")
    required = ["ui_ready", "initially_empty", "conversation_roundtrip", "private_mode", "hidden_after_close",
                "reopened", "external_data", "memory_external_data", "bundle_unchanged", "signature_valid_after_run"]
    require(all(checks.get(key) is True for key in required), "A required native smoke check failed")
    require(smoke.get("renderer_errors") == [] and smoke.get("models_downloaded") is False,
            "Unexpected renderer error or model download")
    artifacts = build.get("artifacts", [])
    require(isinstance(artifacts, list) and len(artifacts) == 2, "Build report must list exactly ZIP and DMG")
    verified = {}
    for item in artifacts:
        original = item.get("file", "")
        require(isinstance(original, str) and "\\" not in original and ".." not in PurePosixPath(original).parts,
                "Unsafe build artifact filename")
        name = PurePosixPath(original).name
        require(name in PREVIEWS and name not in verified, "Unexpected or duplicate native build filename")
        size, digest = item.get("bytes"), item.get("sha256")
        require(type(size) is int and 0 < size <= MAX_BYTES and isinstance(digest, str) and HEX.fullmatch(digest),
                "Invalid native build size or digest")
        require((directory / name).stat().st_size == size and sha256(directory / name) == digest,
                "Native preview differs from build report")
        verified[name] = {"bytes": size, "sha256": digest}
    require(set(verified) == PREVIEWS, "Build report omitted a native preview")
    return verified


def verify_asset(asset, name, expected):
    require(asset.get("name") == name and asset.get("state") == "uploaded" and
            asset.get("size") == expected["bytes"] and
            asset.get("digest") == "sha256:" + expected["sha256"],
            "Release asset filename, size or remote SHA-256 differs; no asset is replaced")


def publish(client, directory, verified):
    verify_run(client)
    release = verify_release(client)
    checksum = directory / "checksum.txt"
    with checksum.open("x", encoding="ascii", newline="\n") as stream:
        stream.write("".join(verified[name]["sha256"] + "  " + name + "\n" for name in sorted(verified)))
    uploads = {**verified, checksum.name: {"bytes": checksum.stat().st_size, "sha256": sha256(checksum)}}
    # Preflight every conflict before the first upload; never delete or clobber.
    for name, expected in uploads.items():
        matches = [item for item in release.get("assets", []) if item.get("name") == name]
        require(len(matches) <= 1, "Duplicate Release asset names require manual inspection")
        if matches:
            verify_asset(matches[0], name, expected)
    result = []
    for name, expected in sorted(uploads.items()):
        path = directory / name
        require(path.is_file() and not path.is_symlink() and path.stat().st_size == expected["bytes"] and
                sha256(path) == expected["sha256"], "Local verified asset changed before upload")
        verify_run(client)
        release = verify_release(client)
        matches = [item for item in release.get("assets", []) if item.get("name") == name]
        require(len(matches) <= 1, "Duplicate Release asset names require manual inspection")
        reused = bool(matches)
        asset = matches[0] if reused else client.upload(release, path)
        verify_asset(asset, name, expected)
        # Read metadata independently after upload instead of trusting the POST alone.
        verify_asset(client.api(REPO + f"/releases/assets/{asset['id']}"), name, expected)
        result.append({"name": name, **expected, "reused": reused})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    require(os.environ.get("GITHUB_REPOSITORY", "").lower() == FULL_NAME.lower(), "Unexpected workflow repository")
    require(os.environ.get("GITHUB_REF") == "refs/heads/delivery/macos-v0.10.0", "Unexpected delivery branch")
    directory = args.directory.resolve()
    verified = verify_files(directory)
    client = GitHub(os.environ.get("GITHUB_TOKEN"))
    verify_run(client)
    verify_release(client)
    result = {"verified": True, "published": False, "version": VERSION, "original_run": RUN, "commit": COMMIT}
    if args.publish:
        result["assets"] = publish(client, directory, verified)
        result["published"] = True
    else:
        result["files"] = verified
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except DeliveryError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        raise SystemExit("Native CI delivery failed; no credentials or signed URLs logged") from None
