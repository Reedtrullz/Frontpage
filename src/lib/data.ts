import { personal, type PersonalData } from "@/data/personal";
import { projects, type Project } from "@/data/projects";

export function getPersonal(): PersonalData {
  return structuredClone(personal);
}

export function getProjects(): Project[] {
  return structuredClone(projects);
}

export function getProject(slug: string): Project | undefined {
  return getProjects().find((p) => p.slug === slug);
}
