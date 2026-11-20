import type { Metadata } from "next";

/**
 * A share link that's off, unknown or malformed (page.tsx calls notFound()), answered with a 404. It says the same
 * thing for all three, so the page never tells anyone whether a link once worked.
 */
export const metadata: Metadata = {
  title: "Link off or not found",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SharedRecordNotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="font-heading text-lg font-bold">PERM Tracker</p>{" "}
      <h1 className="mt-8 font-heading text-3xl font-bold">This link is off or doesn&apos;t exist</h1>{" "}
      <p className="mt-3 max-w-prose text-lg text-soft">
        If your attorney&apos;s office shared a recruitment record with you, ask them for a new link.
      </p>{" "}
      <p className="mt-8">
        <a href="/about" className="link inline-flex min-h-11 items-center">
          About PERM Tracker
        </a>
      </p>
    </main>
  );
}
