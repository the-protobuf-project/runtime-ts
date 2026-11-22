#!/usr/bin/env bash
# Sets every package in packages/ to one version, and the ranges they use for
# each other to match. Usage: ./scripts/version.sh 0.2.0
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?usage: scripts/version.sh <version>}"
for p in packages/*/package.json; do
  bun -e '
    const [file, version] = process.argv.slice(1);
    const pkg = await Bun.file(file).json();
    pkg.version = version;
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (name.startsWith("@the-protobuf-project/runtime-ts-")) pkg.dependencies[name] = `^${version}`;
    }
    await Bun.write(file, JSON.stringify(pkg, null, 2) + "\n");
  ' "$p" "$version"
done
bun install
echo "packages set to $version; commit, then: git tag v$version && git push origin v$version"
