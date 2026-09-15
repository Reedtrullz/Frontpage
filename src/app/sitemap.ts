import type { MetadataRoute } from "next";
import { getCanonicalProjects } from "@/lib/content";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://reidar.tech";
  return [
    `${baseUrl}/`,
    `${baseUrl}/projects`,
    `${baseUrl}/status`,
    ...getCanonicalProjects().map((project) => `${baseUrl}/projects/${project.slug}`),
  ].map((url) => ({ url }));
}
