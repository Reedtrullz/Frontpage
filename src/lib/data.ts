import fs from "node:fs";
import path from "node:path";
import { personal as bundledPersonal, type PersonalData } from "@/data/personal";
import {
  projects as bundledProjects,
  type Project,
} from "@/data/projects";

const DATA_DIR = process.env.DATA_DIR || "public/data";

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function quarantineCorruptFile(filePath: string): void {
  const timestamp = Date.now();
  let suffix = 0;
  let corruptPath = `${filePath}.corrupt.${timestamp}`;
  while (fs.existsSync(corruptPath)) {
    suffix += 1;
    corruptPath = `${filePath}.corrupt.${timestamp}.${suffix}`;
  }
  fs.renameSync(filePath, corruptPath);
}

function readJSON<T>(filename: string, fallback: T): T {
  ensureDataDir();
  const p = path.join(DATA_DIR, filename);
  const versionFile = path.join(DATA_DIR, ".data_version");
  const currentVersion = process.env.VERSION || "dev";

  if (fs.existsSync(p)) {
    const raw = fs.readFileSync(p, "utf-8");
    try {
      const parsed = JSON.parse(raw) as T;
      if (!fs.existsSync(versionFile)) {
        fs.writeFileSync(versionFile, currentVersion);
      }
      return parsed;
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      quarantineCorruptFile(p);
    }
  }

  fs.writeFileSync(p, JSON.stringify(fallback, null, 2));
  fs.writeFileSync(versionFile, currentVersion);
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
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, "personal.json"), JSON.stringify(data, null, 2));
}

export function saveProjects(data: Project[]) {
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, "projects.json"), JSON.stringify(data, null, 2));
}
