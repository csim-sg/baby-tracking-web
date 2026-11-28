/**
 * Shared scaffolding for the auth pages (issue #24). Non-route file
 * (TanStack Router `-` prefix). Plain anchors only — every navigation
 * between surfaces is a full-document load (FR-03), and these pages never
 * load GTM/analytics in any mode (the root document computes the flag from
 * the route).
 */
import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-xl border border-[--color-line] bg-white p-6 shadow-sm">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold text-stone-900">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-stone-600">{subtitle}</p>}
        <div className="mt-5 flex flex-col gap-4">{children}</div>
      </div>
      {footer && (
        <div className="mt-4 text-sm text-stone-600 [text-align:center]">
          {footer}
        </div>
      )}
      <p className="mt-6 [text-align:center]">
        <a
          href="/"
          className="text-sm font-medium text-[--color-control-green] underline-offset-2 hover:underline"
        >
          Toddlebook home
        </a>
      </p>
    </main>
  );
}

export function Field({
  label,
  name,
  type,
  value,
  onChange,
  error,
  autoComplete,
  required,
}: {
  label: string;
  name: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-sm font-medium text-stone-800"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className="mt-1 w-full rounded-lg border border-[--color-control-line] bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-[--color-control-green] focus:ring-2 focus:ring-[--color-control-green]/30"
      />
      {error && (
        <p id={`${name}-error`} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-[--color-control-green] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--color-control-green] disabled:opacity-60"
    >
      {pending ? "Working…" : children}
    </button>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "info" | "success" | "error";
  children: ReactNode;
}) {
  const toneClass =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "success"
        ? "border-[--color-active-line] bg-[--color-active-wash] text-[--color-active-green]"
        : "border-stone-200 bg-stone-50 text-stone-700";
  return (
    <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${toneClass}`}>
      {children}
    </p>
  );
}

/** Extracts the SPEC envelope message from a thrown/returned outcome. */
export function envelopeMessage(
  error: unknown,
  fallback: string,
): string {
  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    error.error &&
    typeof error.error === "object" &&
    "message" in error.error
  ) {
    const message = (error.error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return fallback;
}
