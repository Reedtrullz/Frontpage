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

function readJSON<T>(filename: string, fallback: T): T {
  ensureDataDir();
  const p = path.join(DATA_DIR, filename);
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  }
  fs.writeFileSync(p, JSON.stringify(fallback, null, 2));
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
