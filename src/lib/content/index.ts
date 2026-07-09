import personalJson from "../../../content/personal.json";
import projectsJson from "../../../content/projects.json";
import {
  parsePersonal,
  parseProjects,
  type PersonalContent,
  type ProjectContent,
} from "./schema";

const canonicalPersonal = parsePersonal(personalJson);
const canonicalProjects = parseProjects(projectsJson);

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
