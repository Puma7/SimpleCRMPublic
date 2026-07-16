import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"

/**
 * Rendered display for internal notes. Input stays a plain textarea and the
 * note body is persisted as a plain string — only the display is Markdown.
 * Backward-compatible with plain-text notes: single line breaks stay visible
 * (remark-breaks, like the old whitespace-pre-wrap display) and raw HTML such
 * as "Kunde <VIP>" is rendered as literal text (react-markdown never executes
 * HTML without rehype-raw). Images are disallowed so notes can't load remote
 * tracking pixels. Links are rendered inert (no href), so no browser default
 * — click, middle-click, context menu "open in new tab", drag — can navigate
 * directly; every activation goes through onOpenLink, which routes into the
 * confirm-and-open-externally flow.
 */
export function NoteMarkdown({
  body,
  onOpenLink,
}: {
  body: string
  onOpenLink: (href: string) => void
}) {
  return (
    <div className="max-w-none break-words text-xs [&_a]:cursor-pointer [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:text-xs [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-1.5 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        disallowedElements={["img"]}
        components={{
          a: ({ node: _node, href, children, ...rest }) => (
            <a
              {...rest}
              role="link"
              tabIndex={0}
              title={href}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (href) onOpenLink(href)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && href) {
                  e.preventDefault()
                  e.stopPropagation()
                  onOpenLink(href)
                }
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
