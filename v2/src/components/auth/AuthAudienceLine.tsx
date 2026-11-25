/** Who an account is for, in the words sign-up, sign-in and their page descriptions share. */
export const AUTH_AUDIENCE = "Track your own case, or every case you manage.";

/**
 * The line under the sign-up and sign-in headings: an account is for the person waiting on their own case and for
 * the people managing cases. Words only, so the form asks nothing more of either.
 */
export function AuthAudienceLine() {
  return <p className="text-base leading-relaxed text-muted-foreground">{AUTH_AUDIENCE}</p>;
}
