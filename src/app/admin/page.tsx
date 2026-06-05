import type { PersonalData } from "@/data/personal";
import type { Project } from "@/data/projects";
import { getPersonal, getProjects } from "@/lib/data";
import { AdminClient } from "./admin-client";

export default function AdminPage() {
  let initialPersonal: PersonalData | null;
  let initialProjects: Project[];
  let initialError: string | undefined;

  try {
    initialPersonal = getPersonal();
    initialProjects = getProjects();
  } catch (error) {
    console.error("Failed to load admin data", error);
    initialPersonal = null;
    initialProjects = [];
    initialError = error instanceof Error ? error.message : "Failed to load data";
  }

  return (
    <AdminClient
      initialPersonal={initialPersonal}
      initialProjects={initialProjects}
      initialError={initialError}
    />
  );
}
