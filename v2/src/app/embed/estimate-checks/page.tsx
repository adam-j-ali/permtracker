import { EmbedFrame, embedMetadata } from "@/components/embed/EmbedFrame";
import ToolPage from "@/app/(site)/(public)/estimate-scorecard/page";

// The page's own section, framed (see EmbedFrame). Same data window as the page.
export const revalidate = 21600;

export const metadata = embedMetadata("estimate-checks");

export default function Embed() {
  return (
    <EmbedFrame slug="estimate-checks">
      <ToolPage />
    </EmbedFrame>
  );
}
