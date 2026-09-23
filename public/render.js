// Renders AI-generated markdown (headings, tables, bold, ```mermaid fences, etc.) into an
// element instead of dumping raw "# ..." / "**..**" text. The content comes from an LLM
// responding to a user-supplied goal, and on a shared /r/:id page it's viewed by people who
// aren't the one who typed that goal — so it's sanitized before going into innerHTML.
function renderMarkdownInto(el, markdown) {
  const html = DOMPurify.sanitize(marked.parse(markdown));
  el.innerHTML = html;
  const mermaidBlocks = el.querySelectorAll("code.language-mermaid");
  if (mermaidBlocks.length && window.mermaid) {
    mermaidBlocks.forEach((code) => {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      code.closest("pre").replaceWith(div);
    });
    mermaid.run({ nodes: el.querySelectorAll(".mermaid") });
  }
}
