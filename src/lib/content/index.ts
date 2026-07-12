import personalJson from "../../../content/personal.json";
import projectsJson from "../../../content/projects.json";
import maintenanceJson from "../../../content/maintenance.json";
import {
  parsePersonal,
  parseProjects,
  parseMaintenanceWindows,
  type MaintenanceWindow,
  type PersonalContent,
  type ProjectContent,
} from "./schema";

const canonicalPersonal = parsePersonal(personalJson);
const canonicalProjects = parseProjects(projectsJson);
const canonicalPublicServiceIds = new Set(
  canonicalProjects.flatMap((project) => project.healthServiceIds ?? []),
);
const canonicalMaintenance = parseMaintenanceWindows(
  maintenanceJson,
  canonicalPublicServiceIds,
);

export function getCanonicalPersonal(): PersonalContent {
  return structuredClone(canonicalPersonal);
}

export function getCanonicalProjects(): ProjectContent[] {
  return structuredClone(canonicalProjects);
}

export function getCanonicalProject(slug: string): ProjectContent | undefined {
  const project = canonicalProjects.find((item) => item.slug === slug);
  return project ? structuredClone(project) : undefined;
}

export function getCanonicalMaintenance(): MaintenanceWindow[] {
  return structuredClone(canonicalMaintenance);
}
