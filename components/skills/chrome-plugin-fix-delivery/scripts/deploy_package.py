#!/usr/bin/env python3
"""Inspect, deploy, or roll back the Chrome plugin fix delivery package."""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_PACKAGE = SKILL_DIR / "assets" / "chrome-plugin-fix-delivery-20260727.tar.gz"
EXPECTED_SHA1 = "e52d245d3a157edfb8703ec2fb3b8fb0b0ca13b7"

DEFAULT_CHROME_PLUGIN_PARENT = Path(
    "/Users/dmeck/Downloads/codex-original-dmg-codex-home/plugins/cache/openai-bundled/chrome"
)
DEFAULT_EXTENSION_PARENT = Path("/Users/dmeck/project/CodexChromePlug/codex-1.1.5_0")
DEFAULT_SKILLS_DIR = Path("/Users/dmeck/.agents/skills")
DEFAULT_CODEX_CONFIG = Path("/Users/dmeck/Downloads/codex-original-dmg-codex-home/browser/config.toml")
DEFAULT_HOME_CONFIG = Path("/Users/dmeck/.codex/browser/config.toml")


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_extract(tar: tarfile.TarFile, dest: Path) -> None:
    dest = dest.resolve()
    for member in tar.getmembers():
        target = (dest / member.name).resolve()
        if not str(target).startswith(str(dest) + os.sep) and target != dest:
            raise RuntimeError(f"Unsafe tar path: {member.name}")
    try:
        tar.extractall(dest, filter="fully_trusted")
    except TypeError:
        tar.extractall(dest)


def extract_package(package: Path, dest: Path) -> Path:
    with tarfile.open(package, "r:gz") as tar:
        safe_extract(tar, dest)
    roots = [p for p in dest.iterdir() if p.is_dir()]
    if len(roots) != 1:
        raise RuntimeError(f"Expected one package root, found {len(roots)}")
    return roots[0]


def count_tar_entries(path: Path) -> int:
    with tarfile.open(path, "r:gz") as tar:
        return len(tar.getmembers())


def copy_with_backup(src: Path, dst: Path, dry_run: bool) -> None:
    print(f"copy {src} -> {dst}")
    if dry_run:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        stamp = datetime.now().strftime("%Y%m%d%H%M%S")
        backup = dst.with_name(dst.name + f".bak-skill-delivery-{stamp}")
        shutil.copy2(dst, backup)
        print(f"backup {dst} -> {backup}")
    shutil.copy2(src, dst)


def extract_module(module_tar: Path, target_parent: Path, dry_run: bool) -> None:
    print(f"extract {module_tar} -> {target_parent}")
    if dry_run:
        return
    target_parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(module_tar, "r:gz") as tar:
        safe_extract(tar, target_parent)


def ensure_latest_symlink(parent: Path, version: str, dry_run: bool) -> None:
    latest = parent / "latest"
    target = parent / version
    print(f"symlink {latest} -> {target}")
    if dry_run:
        return
    if latest.is_symlink() or latest.exists():
        latest.unlink()
    latest.symlink_to(target)


def node_check(path: Path) -> None:
    try:
        subprocess.run(["node", "--check", str(path)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        print(f"syntax ok: {path}")
    except FileNotFoundError:
        print("warning: node not found; skipped syntax check")
    except subprocess.CalledProcessError as exc:
        sys.stderr.write(exc.stderr)
        raise


def inspect(root: Path, package: Path) -> None:
    print(f"package: {package}")
    print(f"sha1: {sha1(package)}")
    if sha1(package) != EXPECTED_SHA1:
        print(f"warning: expected bundled sha1 {EXPECTED_SHA1}")
    print("top-level members:")
    for path in sorted(root.iterdir()):
        print(f"  {path.name}")
    modules = root / "modules"
    for name in [
        "codex-extension-1.1.5_0-patched.tar.gz",
        "chrome-plugin-26.601.21317-patched.tar.gz",
        "codex-browser-config.tar.gz",
        "skills-chrome-plugin.tar.gz",
    ]:
        mod = modules / name
        print(f"module {name}: {count_tar_entries(mod)} entries, sha1 {sha1(mod)}")


def deploy(root: Path, args: argparse.Namespace) -> None:
    modules = root / "modules"
    if args.deploy_client or args.deploy_all:
        extract_module(modules / "chrome-plugin-26.601.21317-patched.tar.gz", args.chrome_plugin_parent, args.dry_run)
        ensure_latest_symlink(args.chrome_plugin_parent, "26.601.21317", args.dry_run)
        node_check(args.chrome_plugin_parent / "26.601.21317" / "scripts" / "browser-client.mjs")
    if args.deploy_extension or args.deploy_all:
        extract_module(modules / "codex-extension-1.1.5_0-patched.tar.gz", args.extension_parent, args.dry_run)
        node_check(args.extension_parent / "1.1.5_0" / "background.js")
        print("reload required: chrome://extensions -> Codex -> reload")
    if args.deploy_config or args.deploy_all:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            extract_module(modules / "codex-browser-config.tar.gz", tmp_root, args.dry_run)
            if not args.dry_run:
                copy_with_backup(tmp_root / "codex-home" / "config.toml", args.codex_config, args.dry_run)
                copy_with_backup(tmp_root / "home-codex" / "config.toml", args.home_config, args.dry_run)
    if args.deploy_skills or args.deploy_all:
        extract_module(modules / "skills-chrome-plugin.tar.gz", args.skills_dir, args.dry_run)


def rollback(root: Path, args: argparse.Namespace) -> None:
    backups = root / "backups"
    copy_with_backup(
        backups / "browser-client.mjs.pristine",
        args.chrome_plugin_parent / "26.601.21317" / "scripts" / "browser-client.mjs",
        args.dry_run,
    )
    copy_with_backup(
        backups / "extension-background.js.pristine",
        args.extension_parent / "1.1.5_0" / "background.js",
        args.dry_run,
    )
    copy_with_backup(backups / "home-codex-browser-config.toml.pristine", args.home_config, args.dry_run)
    print("reload required after extension rollback: chrome://extensions -> Codex -> reload")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--package", type=Path, default=DEFAULT_PACKAGE)
    p.add_argument("--inspect", action="store_true", help="inspect package only")
    p.add_argument("--deploy-all", action="store_true")
    p.add_argument("--deploy-client", action="store_true")
    p.add_argument("--deploy-extension", action="store_true")
    p.add_argument("--deploy-config", action="store_true")
    p.add_argument("--deploy-skills", action="store_true")
    p.add_argument("--rollback", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--chrome-plugin-parent", type=Path, default=DEFAULT_CHROME_PLUGIN_PARENT)
    p.add_argument("--extension-parent", type=Path, default=DEFAULT_EXTENSION_PARENT)
    p.add_argument("--skills-dir", type=Path, default=DEFAULT_SKILLS_DIR)
    p.add_argument("--codex-config", type=Path, default=DEFAULT_CODEX_CONFIG)
    p.add_argument("--home-config", type=Path, default=DEFAULT_HOME_CONFIG)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.package.exists():
        raise FileNotFoundError(args.package)
    with tempfile.TemporaryDirectory() as tmp:
        root = extract_package(args.package, Path(tmp))
        if args.inspect or not any(
            [args.deploy_all, args.deploy_client, args.deploy_extension, args.deploy_config, args.deploy_skills, args.rollback]
        ):
            inspect(root, args.package)
        if args.rollback:
            rollback(root, args)
        else:
            deploy(root, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
