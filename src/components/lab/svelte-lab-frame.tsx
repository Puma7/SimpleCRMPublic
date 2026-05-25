"use client"

const DEFAULT_LAB_URL = "http://127.0.0.1:5174"

type Props = {
  className?: string
}

/**
 * Embeds the isolated Svelte lab (separate Vite app). No Svelte in the React bundle.
 */
export function SvelteLabFrame({ className }: Props) {
  const src =
    (import.meta.env.VITE_SVELTE_LAB_URL as string | undefined)?.trim() || DEFAULT_LAB_URL

  return (
    <iframe
      title="Svelte Lab (Beta)"
      src={src}
      className={className ?? "h-[min(70vh,720px)] w-full rounded-md border bg-muted/20"}
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  )
}
