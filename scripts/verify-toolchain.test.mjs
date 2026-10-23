import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "yaml";

const lock = parse(fs.readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"));
const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

test("pnpm lock pins the exact optional native packages for both Linux architectures", () => {
  const expected = {
    "lightningcss-linux-x64-gnu": "1.32.0",
    "lightningcss-linux-arm64-gnu": "1.32.0",
    "@tailwindcss/oxide-linux-x64-gnu": "4.3.2",
    "@tailwindcss/oxide-linux-arm64-gnu": "4.3.2",
    "@rolldown/binding-linux-x64-gnu": "1.2.15",
    "@rolldown/binding-linux-arm64-gnu": "1.2.15",
    "@unrs/resolver-binding-linux-x64-gnu": "1.11.1",
    "@unrs/resolver-binding-linux-arm64-gnu": "1.11.1",
    "@img/sharp-linux-x64": "0.35.5",
    "@img/sharp-linux-arm64": "0.35.5",
    "@img/sharp-libvips-linux-x64": "1.3.4",
    "@img/sharp-libvips-linux-arm64": "1.3.4",
  };
  for (const [name, version] of Object.entries(expected)) {
    const key = `${name}@${version}`;
    assert.ok(lock.packages[key], `${name} lock resolution`);
    assert.equal(lock.snapshots[key]?.optional, true, `${name} is an optional platform package`);
    assert.equal(lock.packages[key]?.os?.[0], "linux", `${name} operating system`);
    assert.equal(lock.packages[key]?.cpu?.[0], name.includes("arm64") ? "arm64" : "x64", `${name} architecture`);
  }
});

test("tool pins target the verified Node image digest and exact Ansible toolchain", () => {
  assert.match(dockerfile, /node:22\.22\.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752/);
  assert.match(dockerfile, /RUN pnpm install --frozen-lockfile/);
  assert.doesNotMatch(dockerfile, /npm install --no-save/);
  assert.equal(fs.readFileSync(new URL("../ops/requirements-ansible.txt", import.meta.url), "utf8").trim(), "ansible-core==2.21.2");
  const collections = fs.readFileSync(new URL("../ops/ansible/requirements.yml", import.meta.url), "utf8");
  assert.match(collections, /ansible\.posix\n\s+version: 2\.2\.2/);
  assert.match(collections, /community\.docker\n\s+version: 5\.2\.1/);
});

test("parent lock repair targets already-resolved exact jose and esbuild versions", () => {
  assert.equal(lock.importers["."].dependencies.jose?.version, "6.2.9");
  assert.equal(lock.importers["."].devDependencies.esbuild?.version, "0.28.2");
});
