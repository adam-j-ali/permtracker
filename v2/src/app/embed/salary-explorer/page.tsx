import { EmbedFrame, embedMetadata } from "@/components/embed/EmbedFrame";
import { WageExplorer } from "@/components/wages/WageExplorer";

// The PERM wage filters, framed (see EmbedFrame). They live on /perm-wages since Nov 24 2026; the embed keeps its
// address, because sites already carry it. Same data window as the page.
export const revalidate = 604800;

export const metadata = embedMetadata("salary-explorer");

export default function Embed() {
  return (
    <EmbedFrame slug="salary-explorer">
      <WageExplorer />
    </EmbedFrame>
  );
}
