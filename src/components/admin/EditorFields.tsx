import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const controlClass =
  "mt-1 min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:border-[var(--focus)] focus:outline-none";

export function EditorSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--border)] pt-8">
      <h2 className="text-xl font-semibold text-[var(--text)]">{title}</h2>
      {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">{description}</p> : null}
      <div className="mt-5 grid gap-4">{children}</div>
    </section>
  );
}

export function TextField({
  label,
  hint,
  containerClassName,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  containerClassName?: string;
}) {
  return (
    <label className={`block text-sm text-[var(--text-muted)] ${containerClassName ?? ""}`}>
      <span className="font-medium text-[var(--text)]">{label}</span>
      <input {...props} className={`${controlClass} ${props.className ?? ""}`} />
      {hint ? <span className="mt-1 block text-xs text-[var(--text-subtle)]">{hint}</span> : null}
    </label>
  );
}

export function TextAreaField({
  label,
  hint,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <label className="block text-sm text-[var(--text-muted)]">
      <span className="font-medium text-[var(--text)]">{label}</span>
      <textarea {...props} className={`${controlClass} resize-y ${props.className ?? ""}`} />
      {hint ? <span className="mt-1 block text-xs text-[var(--text-subtle)]">{hint}</span> : null}
    </label>
  );
}

export function SelectField({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm text-[var(--text-muted)]">
      <span className="font-medium text-[var(--text)]">{label}</span>
      <select {...props} className={`${controlClass} ${props.className ?? ""}`}>
        {children}
      </select>
    </label>
  );
}
