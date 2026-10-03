import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installKnownHosts } from "./install-known-hosts.mjs";

const host = "198.23.137.16";
function sshKey() {
  const type = Buffer.from("ssh-ed25519");
  const blob = Buffer.concat([
    Buffer.from([0, 0, 0, type.length]), type,
    Buffer.from([0, 0, 0, 32]), Buffer.alloc(32, 7),
  ]);
  return `ssh-ed25519 ${blob.toString("base64")}`;
}

test("known-host installer writes only an exact-host public pin with private file mode", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-known-hosts-"));
  try {
    const outputPath = path.join(directory, "ssh", "known_hosts");
    const result = installKnownHosts({ knownHosts: `${host} ${sshKey()}\n`, outputPath });
    assert.equal(result.host, host);
    assert.equal(fs.readFileSync(outputPath, "utf8"), `${host} ${sshKey()}\n`);
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("missing, wrong-host, multiple, hashed, and malformed pins fail closed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-known-hosts-invalid-"));
  try {
    const outputPath = path.join(directory, "known_hosts");
    for (const knownHosts of [
      "",
      `other.example ${sshKey()}`,
      `${host} ${sshKey()}\n${host} ${sshKey()}`,
      `|1|hashed|hostname ${sshKey()}`,
      `${host} ssh-ed25519 not-base64!`,
    ]) {
      assert.throws(() => installKnownHosts({ knownHosts, outputPath }));
      assert.equal(fs.existsSync(outputPath), false);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("known-host installer refuses to overwrite an existing trust file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-known-hosts-existing-"));
  try {
    const outputPath = path.join(directory, "known_hosts");
    fs.writeFileSync(outputPath, "operator data\n");
    assert.throws(() => installKnownHosts({ knownHosts: `${host} ${sshKey()}`, outputPath }));
    assert.equal(fs.readFileSync(outputPath, "utf8"), "operator data\n");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
