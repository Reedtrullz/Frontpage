"use client";

import { useState, useEffect } from "react";
import type { PersonalData } from "@/data/personal";
import type { Project } from "@/data/projects";

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="font-mono text-sm text-green-500 mb-4">{title}</h2>
  );
}

function TextField({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  const shared =
    "w-full px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm text-zinc-200 focus:outline-none focus:border-green-500/50 transition-colors";
  return (
    <label className="block mb-3">
      <span className="block text-xs text-zinc-500 mb-1 font-mono">
        {label}
      </span>
      {multiline ? (
        <textarea
          className={shared}
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={shared}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

export default function AdminPage() {
  const [personal, setPersonal] = useState<PersonalData | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/data")
      .then((r) => r.json())
      .then((d) => {
        setPersonal(d.personal);
        setProjects(d.projects);
      });
  }, []);

  const savePersonal = async () => {
    if (!personal) return;
    setSaving(true);
    setMessage("");
    const res = await fetch("/api/data/personal", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(personal),
    });
    const data = await res.json();
    setMessage(data.synced ? "Saved & synced to GitHub" : "Saved");
    setSaving(false);
  };

  const saveProjects = async () => {
    setSaving(true);
    setMessage("");
    const res = await fetch("/api/data/projects", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projects),
    });
    const data = await res.json();
    setMessage(data.synced ? "Saved & synced to GitHub" : "Saved");
    setSaving(false);
  };

  const updateSkill = (index: number, value: string) => {
    if (!personal) return;
    const skills = [...personal.skills];
    skills[index] = value;
    setPersonal({ ...personal, skills });
  };

  const addSkill = () => {
    if (!personal) return;
    setPersonal({ ...personal, skills: [...personal.skills, ""] });
  };

  const removeSkill = (index: number) => {
    if (!personal) return;
    setPersonal({
      ...personal,
      skills: personal.skills.filter((_, i) => i !== index),
    });
  };

  const updateSocial = (index: number, field: "label" | "url", value: string) => {
    if (!personal) return;
    const socials = [...personal.socials];
    socials[index] = { ...socials[index], [field]: value };
    setPersonal({ ...personal, socials });
  };

  const updateProject = (slug: string, field: string, value: unknown) => {
    setProjects(
      projects.map((p) => (p.slug === slug ? { ...p, [field]: value } : p))
    );
  };

  if (!personal) {
    return <p className="text-sm text-zinc-500">Loading...</p>;
  }

  return (
    <div className="space-y-12">
      <section>
        <SectionHeader title="Personal Info" />
        <div className="max-w-xl space-y-1">
          <TextField
            label="Name"
            value={personal.name}
            onChange={(v) => setPersonal({ ...personal, name: v })}
          />
          <TextField
            label="Title"
            value={personal.title}
            onChange={(v) => setPersonal({ ...personal, title: v })}
          />
          <TextField
            label="Location"
            value={personal.location}
            onChange={(v) => setPersonal({ ...personal, location: v })}
          />
          <TextField
            label="Bio"
            value={personal.bio}
            onChange={(v) => setPersonal({ ...personal, bio: v })}
            multiline
          />
        </div>

        <h3 className="font-mono text-xs text-zinc-500 mt-6 mb-3">What I Do</h3>
        <div className="max-w-xl space-y-2 mb-6">
          {personal.whatIDo.map((item, i) => (
            <TextField
              key={i}
              label={`Item ${i + 1}`}
              value={item}
              onChange={(v) => {
                const w = [...personal.whatIDo];
                w[i] = v;
                setPersonal({ ...personal, whatIDo: w });
              }}
            />
          ))}
        </div>

        <h3 className="font-mono text-xs text-zinc-500 mb-3">Skills</h3>
        <div className="max-w-xl space-y-2 mb-6">
          {personal.skills.map((skill, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="flex-1 px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-sm text-zinc-200 focus:outline-none focus:border-green-500/50"
                value={skill}
                onChange={(e) => updateSkill(i, e.target.value)}
              />
              <button
                onClick={() => removeSkill(i)}
                className="px-2 text-xs text-zinc-600 hover:text-red-400 transition-colors"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={addSkill}
            className="text-xs text-green-500 hover:text-green-400 transition-colors"
          >
            + Add skill
          </button>
        </div>

        <h3 className="font-mono text-xs text-zinc-500 mb-3">Social Links</h3>
        <div className="max-w-xl space-y-3 mb-6">
          {personal.socials.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="w-24 px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-sm text-zinc-200 focus:outline-none focus:border-green-500/50"
                value={s.label}
                placeholder="Label"
                onChange={(e) => updateSocial(i, "label", e.target.value)}
              />
              <input
                className="flex-1 px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-sm text-zinc-200 focus:outline-none focus:border-green-500/50"
                value={s.url}
                placeholder="URL"
                onChange={(e) => updateSocial(i, "url", e.target.value)}
              />
            </div>
          ))}
        </div>

        <button
          onClick={savePersonal}
          disabled={saving}
          className="px-4 py-2 rounded bg-green-600 text-sm text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save Personal Info"}
        </button>
      </section>

      <section>
        <SectionHeader title="Projects" />
        <div className="space-y-8">
          {projects.map((project) => (
            <div
              key={project.slug}
              className="p-4 rounded border border-zinc-800 bg-zinc-900/50"
            >
              <div className="grid grid-cols-2 gap-3 mb-3">
                <TextField
                  label="Name"
                  value={project.name}
                  onChange={(v) => updateProject(project.slug, "name", v)}
                />
                <TextField
                  label="Slug"
                  value={project.slug}
                  onChange={(v) => updateProject(project.slug, "slug", v)}
                />
              </div>
              <TextField
                label="Short Description"
                value={project.shortDescription}
                onChange={(v) =>
                  updateProject(project.slug, "shortDescription", v)
                }
              />
              <TextField
                label="Long Description"
                value={project.longDescription}
                onChange={(v) =>
                  updateProject(project.slug, "longDescription", v)
                }
                multiline
              />
              <div className="grid grid-cols-3 gap-3 mt-3">
                <label className="block">
                  <span className="block text-xs text-zinc-500 mb-1 font-mono">
                    Status
                  </span>
                  <select
                    className="w-full px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm text-zinc-200"
                    value={project.status}
                    onChange={(e) =>
                      updateProject(project.slug, "status", e.target.value)
                    }
                  >
                    <option value="active">Active</option>
                    <option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="paused">Paused</option>
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs text-zinc-500 mb-1 font-mono">
                    Category
                  </span>
                  <select
                    className="w-full px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm text-zinc-200"
                    value={project.category}
                    onChange={(e) =>
                      updateProject(project.slug, "category", e.target.value)
                    }
                  >
                    <option value="defi">DeFi</option>
                    <option value="bot">Bot</option>
                    <option value="frontend">Frontend</option>
                    <option value="tooling">Tooling</option>
                    <option value="wiki">Wiki</option>
                    <option value="infra">Infra</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    checked={project.featured}
                    onChange={(e) =>
                      updateProject(project.slug, "featured", e.target.checked)
                    }
                    className="rounded border-zinc-700 bg-zinc-800"
                  />
                  <span className="text-xs text-zinc-500 font-mono">
                    Featured
                  </span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <TextField
                  label="Repo URL"
                  value={project.repoUrl || ""}
                  onChange={(v) =>
                    updateProject(project.slug, "repoUrl", v || undefined)
                  }
                />
                <TextField
                  label="Live URL"
                  value={project.liveUrl || ""}
                  onChange={(v) =>
                    updateProject(project.slug, "liveUrl", v || undefined)
                  }
                />
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={saveProjects}
          disabled={saving}
          className="mt-6 px-4 py-2 rounded bg-green-600 text-sm text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save All Projects"}
        </button>
      </section>

      {message && (
        <p className="text-sm text-green-400 font-mono fixed bottom-4 right-4 bg-zinc-900 border border-zinc-800 px-4 py-2 rounded shadow-lg">
          {message}
        </p>
      )}
    </div>
  );
}
