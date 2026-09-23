// Renders AI-generated markdown (headings, tables, bold, ```mermaid fences, etc.) into an
// element instead of dumping raw "# ..." / "**..**" text. The content comes from an LLM
// responding to a user-supplied goal, and on a shared /r/:id page it's viewed by people who
// aren't the one who typed that goal — so it's sanitized before going into innerHTML.
async function renderMarkdownInto(el, markdown) {
  const html = DOMPurify.sanitize(marked.parse(markdown));
  el.innerHTML = html;
  const mermaidBlocks = el.querySelectorAll("code.language-mermaid");
  if (!mermaidBlocks.length || !window.mermaid) return;

  let i = 0;
  for (const code of mermaidBlocks) {
    const source = code.textContent;
    const pre = code.closest("pre");
    // The LLM doesn't always produce syntactically valid Mermaid — render each diagram
    // independently so one bad diagram can't break the rest of the page, and fall back to
    // showing the raw source instead of Mermaid's own "Syntax error in text" error graphic.
    try {
      const { svg } = await mermaid.render(`m-diagram-${Date.now()}-${i++}`, source);
      const div = document.createElement("div");
      div.className = "mermaid";
      div.innerHTML = svg;
      pre.replaceWith(div);
    } catch (err) {
      console.warn("mermaid diagram failed to render, showing raw source instead", err);
    }
  }
}
