import { Hero } from "@/components/home/Hero";
import { About } from "@/components/home/About";
import { FeaturedProjects } from "@/components/home/FeaturedProjects";
import { getPersonal } from "@/lib/data";
import { getProjects } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function Home() {
  const personal = getPersonal();
  const projects = getProjects();

  return (
    <>
      <Hero personal={personal} />
      <About personal={personal} />
      <FeaturedProjects projects={projects} />
    </>
  );
}
