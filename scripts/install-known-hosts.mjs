#!/usr/bin/env node
import { mkdirSync, openSync, writeFileSync, closeSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_HOST = "198.23.137.16";
const SUPPORTED_KEY_TYPES = new Set(["ssh-ed25519", "ecdsa-sha2-nistp256", "ssh-rsa"]);

function validPublicKey(keyType, encoded) {
  if (!SUPPORTED_KEY_TYPES.has(keyType) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  const blob = Buffer.from(encoded, "base64");
  if (blob.length < 32) return false;
  const typeLength = blob.readUInt32BE(0);
  if (typeLength === 0 || typeLength > blob.length - 4) return false;
  return blob.toString("utf8", 4, 4 + typeLength) === keyType;
}

export function validateKnownHostsPin(knownHosts, host = DEFAULT_HOST) {
  if (typeof knownHosts !== "string" || !knownHosts.trim()) {
    throw new Error("RACKNERD_KNOWN_HOSTS is required and must contain an independently verified host key.");
  }
  const records = knownHosts.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (records.length !== 1) throw new Error("RACKNERD_KNOWN_HOSTS must contain exactly one host-key record.");
  const fields = records[0].split(/\s+/);
  const [hosts, keyType, encoded] = fields;
  if (fields.length < 3 || (hosts !== host && hosts !== `[${host}]:22`) || hosts.includes(",") || hosts.startsWith("|")) {
    throw new Error("RACKNERD_KNOWN_HOSTS must pin the exact RackNerd endpoint without aliases or hashes.");
  }
  if (!validPublicKey(keyType, encoded)) throw new Error("RACKNERD_KNOWN_HOSTS contains an unsupported or malformed public key.");
  return `${hosts} ${keyType} ${encoded}\n`;
}

export function installKnownHosts({ knownHosts, outputPath, host = DEFAULT_HOST }) {
  if (!outputPath) throw new Error("An output path is required.");
  const content = validateKnownHostsPin(knownHosts, host);
  const absolute = path.resolve(outputPath);
  mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const descriptor = openSync(absolute, "wx", 0o600);
  try {
    writeFileSync(descriptor, content, { encoding: "utf8" });
  } finally {
    closeSync(descriptor);
  }
  return { host, outputPath: absolute };
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const outputPath = argument(args, "--output");
  if (!outputPath || args.length !== 2) {
    console.error("Usage: RACKNERD_KNOWN_HOSTS=<verified-public-pin> node scripts/install-known-hosts.mjs --output <new-known-hosts-file>");
    process.exitCode = 2;
  } else {
    try {
      const result = installKnownHosts({ knownHosts: process.env.RACKNERD_KNOWN_HOSTS, outputPath });
      console.log(`Installed the configured host identity for ${result.host}.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Could not install the configured host identity.");
      process.exitCode = 1;
    }
  }
}
