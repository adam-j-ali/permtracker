import { EmbedFrame, embedMetadata } from "@/components/embed/EmbedFrame";
import ToolPage from "@/app/(site)/(public)/perm-processing-times/page";

// The page's own answer and figures, framed (see EmbedFrame). Same data window as the page.
export const revalidate = 21600;

export const metadata = embedMetadata("perm-processing-times");

export default function Embed() {
  return (
    <EmbedFrame slug="perm-processing-times">
      <ToolPage />
    </EmbedFrame>
  );
}
