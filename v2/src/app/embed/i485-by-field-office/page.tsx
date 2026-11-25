import { EmbedFrame, embedMetadata } from "@/components/embed/EmbedFrame";
import ToolPage from "@/app/(site)/(public)/i485-by-field-office/page";

// The page's own section, framed (see EmbedFrame). Same data window as the page.
export const revalidate = 604800;

export const metadata = embedMetadata("i485-by-field-office");

export default function Embed() {
  return (
    <EmbedFrame slug="i485-by-field-office">
      <ToolPage />
    </EmbedFrame>
  );
}
