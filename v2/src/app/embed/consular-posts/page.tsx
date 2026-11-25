import { EmbedFrame, embedMetadata } from "@/components/embed/EmbedFrame";
import ToolPage from "@/app/(site)/(public)/consular-posts/page";

// The page's own section, framed (see EmbedFrame). Same data window as the page.
export const revalidate = 86400;

export const metadata = embedMetadata("consular-posts");

export default function Embed() {
  return (
    <EmbedFrame slug="consular-posts">
      <ToolPage />
    </EmbedFrame>
  );
}
