import { EmbedFrame, embedMetadata } from "@/components/embed/EmbedFrame";
import ToolPage from "@/app/(site)/(public)/green-card-timelines/page";

// The page's own section, framed (see EmbedFrame). Same data window as the page.
export const revalidate = 21600;

export const metadata = embedMetadata("reported-timelines");

export default function Embed() {
  return (
    <EmbedFrame slug="reported-timelines">
      <ToolPage />
    </EmbedFrame>
  );
}
