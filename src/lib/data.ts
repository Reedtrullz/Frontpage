import fs from "node:fs";
import path from "node:path";
import { personal, type PersonalData } from "@/data/personal";
import { projects, type Project } from "@/data/projects";

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

export function getPersonal(): PersonalData {
  return structuredClone(personal);
}

export function getProjects(): Project[] {
  return structuredClone(projects);
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
