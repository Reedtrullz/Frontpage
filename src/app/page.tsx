import { Hero } from "@/components/home/Hero";
import { About } from "@/components/home/About";
import { FeaturedProjects } from "@/components/home/FeaturedProjects";
import { personal } from "@/data/personal";

export default function Home() {
  return (
    <>
      <Hero personal={personal} />
      <About personal={personal} />
      <FeaturedProjects />
    </>
  );
}
