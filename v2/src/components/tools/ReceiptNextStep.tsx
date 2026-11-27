import { UscisReceiptForm } from "./UscisReceiptForm";
import { cn } from "@/lib/utils";

/**
 * The closing box on the pages past PERM (the I-140, the I-485, after the green card, the USCIS pages): a USCIS
 * receipt, where the PERM box would ask for a case number those readers no longer have (Nov 26 2026).
 */
export function ReceiptNextStep({ className }: { className?: string }) {
  return (
    <section aria-label="Check a USCIS receipt" className={cn("object p-5 sm:p-6", className)}>
      <h2 className="text-balance font-heading text-xl font-bold leading-tight">Waiting on USCIS?</h2>{" "}
      <p className="mt-2 text-base leading-relaxed">
        Type your receipt number to see what it says, how the cases filed near it are moving, and get an email when its
        status changes.
      </p>{" "}
      <UscisReceiptForm className="mt-4" />
    </section>
  );
}
