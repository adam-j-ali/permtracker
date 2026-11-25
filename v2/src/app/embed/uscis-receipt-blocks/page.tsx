import { EmbedFrame, embedMetadata } from "@/components/embed/EmbedFrame";
import ToolPage from "@/app/(site)/(public)/uscis-receipt-blocks/page";

// The page's own section, framed (see EmbedFrame). Same data window as the page.
export const revalidate = 3600;

export const metadata = embedMetadata("uscis-receipt-blocks");

export default function Embed() {
  return (
    <EmbedFrame slug="uscis-receipt-blocks">
      <ToolPage />
    </EmbedFrame>
  );
}
