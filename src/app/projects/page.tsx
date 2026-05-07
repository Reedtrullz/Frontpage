import { getProjects } from "@/lib/data";
import { ProjectList } from "@/components/projects/ProjectList";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Projects — Reidar",
  description: "All projects — DeFi, bots, frontends, and tooling.",
};

export default function ProjectsPage() {
  const projects = getProjects();
  return <ProjectList projects={projects} />;
}
