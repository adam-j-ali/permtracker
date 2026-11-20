import { NewTabLink } from "@/components/ui/new-tab-link";

/**
 * A case's number or code where the public site has a page for it: a link that opens a new tab, so the case stays on
 * screen. Plain text when there's no page (a typo, an internal reference), and "-" when there's no value.
 */
export function PublicNumber({
  value,
  href,
  className,
}: {
  value: string | null | undefined;
  href: string | null;
  className?: string;
}) {
  if (!value) return <>-</>;
  if (!href) return <span className={className}>{value}</span>;
  return (
    <NewTabLink href={href} className={className}>
      {value}
    </NewTabLink>
  );
}
