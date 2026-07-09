import fs from "node:fs";
import path from "node:path";
import { personal as bundledPersonal, type PersonalData } from "@/data/personal";
import {
  projects as bundledProjects,
  type Project,
} from "@/data/projects";

const DEFAULT_DATA_DIR = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "public",
  "data",
);

function getDataDir(): string {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

function ensureDataDir(dataDir = getDataDir()) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function isFsErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function readCachedVersion(versionFile: string, filename: string): string {
  try {
    return fs.readFileSync(/* turbopackIgnore: true */ versionFile, "utf-8").trim();
  } catch (error) {
    if (isFsErrorCode(error, "ENOENT")) {
      return "";
    }

    console.error(`Failed to read version file for ${filename}; using fallback`, error);
    return "";
  }
}

function readJSON<T>(filename: string, fallback: T): T {
  const dataDir = getDataDir();
  ensureDataDir(dataDir);
  const p = path.join(/* turbopackIgnore: true */ dataDir, filename);
  const versionFile = path.join(
    /* turbopackIgnore: true */ dataDir,
    ".data_version",
  );
  const currentVersion = process.env.VERSION || "dev";

  const cachedVersion = readCachedVersion(versionFile, filename);

  if (fs.existsSync(p) && cachedVersion === currentVersion) {
    try {
      return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ p, "utf-8")) as T;
    } catch (error) {
      console.error(`Failed to parse JSON for ${filename}; using fallback`, error);
      return fallback;
    }
  }

  fs.writeFileSync(/* turbopackIgnore: true */ p, JSON.stringify(fallback, null, 2));
  fs.writeFileSync(/* turbopackIgnore: true */ versionFile, currentVersion);
  return fallback;
}

export function getPersonal(): PersonalData {
  return readJSON("personal.json", bundledPersonal);
}

export function getProjects(): Project[] {
  return readJSON("projects.json", bundledProjects);
}

export function getProject(slug: string): Project | undefined {
  return getProjects().find((p) => p.slug === slug);
}

export function savePersonal(data: PersonalData) {
  const dataDir = getDataDir();
  ensureDataDir(dataDir);
  fs.writeFileSync(
    /* turbopackIgnore: true */ path.join(
      /* turbopackIgnore: true */ dataDir,
      "personal.json",
    ),
    JSON.stringify(data, null, 2),
  );
}

export function saveProjects(data: Project[]) {
  const dataDir = getDataDir();
  ensureDataDir(dataDir);
  fs.writeFileSync(
    /* turbopackIgnore: true */ path.join(
      /* turbopackIgnore: true */ dataDir,
      "projects.json",
    ),
    JSON.stringify(data, null, 2),
  );
}
