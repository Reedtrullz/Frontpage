import { getCanonicalProjects } from "@/lib/content";
import type {
  ProjectCategory,
  ProjectContent,
} from "@/lib/content/schema";

export type ProjectStatus = "active" | "in-progress" | "completed" | "paused";
export type { ProjectCategory };

export interface Project extends ProjectContent {
  status: ProjectStatus;
  featured: boolean;
}

function legacyStatus(project: ProjectContent): ProjectStatus {
  if (project.lifecycle === "active") {
    return project.maturity === "experimental" ? "in-progress" : "active";
  }
  if (project.lifecycle === "paused") return "paused";
  return "completed";
}

export const projects: Project[] = getCanonicalProjects().map((project) => ({
  ...project,
  status: legacyStatus(project),
  featured: project.featuredRank !== undefined,
}));
