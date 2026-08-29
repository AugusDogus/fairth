const sourcePath = new URL("./fairth-flow.mmd", import.meta.url);
const outputPath = new URL("./fairth-flow.svg", import.meta.url);

const renderer = Bun.spawn(
  [
    "bunx",
    "@mermaid-js/mermaid-cli@11.16.0",
    "-i",
    sourcePath.pathname,
    "-o",
    outputPath.pathname,
    "-b",
    "transparent",
    "-w",
    "1600",
  ],
  { stderr: "inherit", stdout: "inherit" },
);

const exitCode = await renderer.exited;
if (exitCode !== 0) {
  throw new Error(`Mermaid renderer exited with status ${exitCode}.`);
}

const darkModeStyles = `<style>
@media (prefers-color-scheme: dark) {
  #my-svg { background-color: #0a0a0a !important; fill: #ededed; }
  #my-svg .cluster rect { fill: #111111 !important; stroke: #262626 !important; }
  #my-svg #my-svg-fairth > rect { fill: #0a0a0a !important; stroke: #525252 !important; }
  #my-svg .cluster-label .nodeLabel,
  #my-svg #my-svg-fairth .cluster-label .nodeLabel { color: #a3a3a3 !important; }
  #my-svg .active rect { fill: #ededed !important; stroke: #ededed !important; }
  #my-svg .active .nodeLabel { color: #0a0a0a !important; }
  #my-svg .supporting rect { fill: #171717 !important; stroke: #333333 !important; }
  #my-svg .supporting .nodeLabel { color: #ededed !important; }
  #my-svg .flowchart-link { stroke: #525252 !important; }
  #my-svg marker path { fill: #525252 !important; stroke: #525252 !important; }
  #my-svg .edgeLabel { color: #a3a3a3 !important; }
  #my-svg .edgeLabel p { background-color: #171717 !important; border-color: #333333; }
}
</style>`;

const svg = await Bun.file(outputPath).text();
const closingTag = "</svg>";
if (!svg.endsWith(closingTag)) {
  throw new Error("Rendered diagram does not end with an SVG closing tag.");
}

await Bun.write(outputPath, `${svg.slice(0, -closingTag.length)}${darkModeStyles}${closingTag}`);
