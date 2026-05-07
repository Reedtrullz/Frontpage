import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ansible — Reidar",
  description: "How Ansible deploys Frontpage, Heimdall, and inebotten to the VPS.",
};

export default function AnsiblePage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight mb-2">
        Ansible Setup &amp; Workflows
      </h1>
      <p className="text-sm text-zinc-500 mb-12">
        How all projects on this VPS — Frontpage, Heimdall, inebotten — are
        deployed with zero-downtime container swaps.
      </p>

      <Section heading="Architecture">
        <p>
          Every project follows the same pattern. Code is pushed to GitHub,
          a CI workflow builds a Docker image and publishes it to GitHub
          Container Registry (GHCR). From there, an Ansible playbook (run from
          my laptop) pulls the image onto the VPS, stops the old container,
          starts a new one, and runs a health check. If the health check
          fails, the playbook automatically rolls back to the previous image.
        </p>

        <div className="mt-4 p-4 rounded border border-zinc-800 bg-zinc-900/50 font-mono text-xs text-zinc-400 leading-relaxed">
          <span className="text-green-400">Local push</span> → GitHub
          <br />
          <span className="text-zinc-600">│</span>
          <br />
          <span className="text-green-400">CI workflow</span> (lint → build →
          publish to GHCR)
          <br />
          <span className="text-zinc-600">│</span>
          <br />
          <span className="text-green-400">ansible-playbook</span> (from
          laptop)
          <br />
          <span className="text-zinc-600">│</span>
          <br />
          <span className="text-green-400">VPS</span> pulls image → swaps
          container → /api/health probe
          <br />
          <span className="text-zinc-600">│</span>
          <br />
          <span className="text-green-400">Caddy</span> reverse proxy
          (https://reidar.tech → localhost:3002)
        </div>
      </Section>

      <Section heading="VPS">
        <p>All projects share a single VPS at 198.23.137.16 (RackNerd).</p>
        <ul>
          <li>User: <Code>deploy</Code></li>
          <li>SSH key: <Code>~/.ssh/id_rsa_racknerd</Code></li>
          <li>Docker + Caddy + UFW + fail2ban</li>
        </ul>
        <p className="mt-2">
          Each project gets its own internal port:
        </p>
        <ul>
          <li><Code>localhost:3001</Code> → Heimdall (bond.thorchain.no)</li>
          <li><Code>localhost:3002</Code> → Frontpage (reidar.tech)</li>
          <li><Code>localhost:8081</Code> → inebotten (bot.reidar.tech)</li>
        </ul>
        <p className="mt-2">
          Caddy handles SSL certificates automatically for all domains.
        </p>
      </Section>

      <Section heading="Playbook">
        <p className="mb-3">
          Every project has an <Code>ansible-playbook.yml</Code> at its root.
          Here&apos;s what happens on a typical run:
        </p>

        <ol className="space-y-4 text-sm text-zinc-400">
          <li>
            <span className="text-green-400 font-mono text-xs">
              1. Record current image
            </span>
            <br />
            Captures the running container&apos;s image hash so the playbook
            can roll back if the new deployment fails.
          </li>
          <li>
            <span className="text-green-400 font-mono text-xs">
              2. Pull latest from GHCR
            </span>
            <br />
            Pulls{" "}
            <Code>ghcr.io/reedtrullz/&lt;project&gt;:latest</Code> with{" "}
            <Code>force_source: yes</Code> to ensure a fresh pull even if the
            local digest already matches.
          </li>
          <li>
            <span className="text-green-400 font-mono text-xs">
              3. Stop + remove old container
            </span>
            <br />
            Zero-downtime isn&apos;t strictly necessary for personal projects.
            The container is stopped and removed before starting the new one
            (~2-3 second gap).
          </li>
          <li>
            <span className="text-green-400 font-mono text-xs">
              4. Start new container
            </span>
            <br />
            Creates a new container with the fresh image, bound to its
            internal port, with log rotation and a Docker health check.
            Environment variables — including vault-encrypted secrets — are
            injected here.
          </li>
          <li>
            <span className="text-green-400 font-mono text-xs">
              5. Health check + rollback
            </span>
            <br />
            The playbook polls <Code>GET /api/health</Code> every 5 seconds
            (up to 10 times). If the app doesn&apos;t become healthy, the
            previous container is restored automatically.
          </li>
          <li>
            <span className="text-green-400 font-mono text-xs">
              6. Report
            </span>
            <br />
            Prints the deployment status — a green checkmark if the container
            is running.
          </li>
        </ol>
      </Section>

      <Section heading="Deploy">
        <p className="mb-3">From the project directory:</p>
        <CodeBlock>
          {`cd /Users/reidar/Projectos/Frontpage
git pull origin main
ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \\
  --vault-password-file ~/.vault_pass.txt`}
        </CodeBlock>
        <p className="mt-3">
          To pin a specific image tag instead of :latest:
        </p>
        <CodeBlock>
          {`ansible-playbook -i inventory/hosts.yml ansible-playbook.yml \\
  -e "docker_image=ghcr.io/reedtrullz/frontpage:sha-cc8e9a5"`}
        </CodeBlock>
      </Section>

      <Section heading="Secrets">
        <p className="mb-3">
          Secrets (GitHub OAuth credentials, PATs, API keys) are stored in
          Ansible Vault files. Each project has its own vault:
        </p>
        <CodeBlock>
          {`# Heimdall
group_vars/vps/vault.yml  (THORNode API, CoinGecko key, etc.)

# Frontpage
group_vars/vps/vault.yml  (AUTH_SECRET, GitHub OAuth, GITHUB_TOKEN)

# inebotten
deploy/group_vars/vps/vault.yml  (OpenRouter API key)`}
        </CodeBlock>
        <p className="mt-3">
          All vaults share the same password file at{" "}
          <Code>~/.vault_pass.txt</Code>. Edit with:
        </p>
        <CodeBlock>
          ansible-vault edit group_vars/vps/vault.yml
        </CodeBlock>
      </Section>

      <Section heading="Verify">
        <CodeBlock>
          {`# Container status
ssh deploy@198.23.137.16 "docker ps --format '{{.Names}} {{.Status}} {{.Image}}'"

# Health endpoints
curl -s https://reidar.tech/api/health | jq
curl -s https://bond.thorchain.no/api/health | jq

# Ansible connectivity
ansible -i inventory/hosts.yml vps -m ping`}
        </CodeBlock>
      </Section>

      <Section heading="CI">
        <p className="mb-3">
          CI workflows live at <Code>.github/workflows/ci.yml</Code> in each
          repo. Every push to main triggers:
        </p>
        <ul>
          <li>Lint + TypeScript check</li>
          <li>Next.js production build</li>
          <li>Docker image build + push to GHCR</li>
        </ul>
        <p className="mt-2">
          The publish step tags each image as{" "}
          <Code>:latest</Code> and <Code>:sha-&lt;short&gt;</Code> for
          version pinning.
        </p>
      </Section>
    </div>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <h2 className="font-mono text-sm text-green-500 mb-4">{heading}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-xs text-zinc-300 font-mono">
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="p-4 rounded border border-zinc-800 bg-zinc-900/50 text-xs text-zinc-400 font-mono leading-relaxed overflow-x-auto">
      {children}
    </pre>
  );
}
