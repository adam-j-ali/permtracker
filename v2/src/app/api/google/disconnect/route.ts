/**
 * Google Calendar OAuth - Disconnect
 *
 * POST /api/google/disconnect
 *
 * Disconnects Google Calendar integration:
 * 1. Clears ALL calendar events from Google Calendar
 * 2. Revokes OAuth token with Google (removes from user's Google permissions)
 * 3. Clears stored tokens from Convex database
 *
 * Query params:
 * - clearEvents=false: Skip clearing calendar events (just disconnect)
 *
 * Token revocation is best-effort - we still clear tokens even if
 * revocation fails (e.g., token already expired or revoked).
 */
import { NextRequest, NextResponse } from "next/server";
import { captureError } from "@/lib/sentry";
import {
  convexAuthNextjsToken,
  isAuthenticatedNextjs,
} from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@convex/_generated/api";

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const isAuthenticated = await isAuthenticatedNextjs();
    if (!isAuthenticated) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get auth token for Convex
    const token = await convexAuthNextjsToken();

    // Check if we should clear events (default: true)
    const { searchParams } = new URL(request.url);
    const clearEvents = searchParams.get("clearEvents") !== "false";

    let eventsCleared = {
      eventsDeleted: 0,
      casesCleaned: 0,
      errors: 0,
    };
    // Once the token is revoked below, nothing here can remove an event, so one left behind is said and reported.
    let eventsLeft = false;

    // Step 1: Clear all calendar events from Google Calendar (if requested)
    if (clearEvents) {
      try {
        const clearResult = await fetchAction(
          api.googleCalendarActions.clearAllEvents,
          {},
          { token }
        );

        if (clearResult.success) {
          eventsCleared = {
            eventsDeleted: clearResult.eventsDeleted,
            casesCleaned: clearResult.casesCleaned,
            errors: clearResult.errors,
          };
          console.log(
            `[Google OAuth] Cleared ${clearResult.eventsDeleted} events from ${clearResult.casesCleaned} cases`
          );
          if (clearResult.errors > 0) {
            eventsLeft = true;
            captureError(new Error(`[Google OAuth] ${clearResult.errors} calendar events couldn't be removed before disconnecting`), {
              operation: "google.disconnect.clearEvents",
            });
          }
        } else if (clearResult.error !== "Google Calendar not connected") {
          // Still disconnect: a refresh token Google no longer honours would otherwise keep the person connected for good.
          eventsLeft = true;
          console.warn("[Google OAuth] Failed to clear events:", clearResult.error);
          captureError(new Error(`[Google OAuth] Failed to clear events before disconnecting: ${clearResult.error}`), {
            operation: "google.disconnect.clearEvents",
          });
        }
      } catch (clearError) {
        // Still disconnect, as above.
        eventsLeft = true;
        console.warn("[Google OAuth] Error clearing events:", clearError);
        captureError(clearError, { operation: "google.disconnect.clearEvents" });
      }
    }

    // Step 2: Disconnect with OAuth token revocation
    const result = await fetchAction(
      api.googleAuth.disconnectWithRevocation,
      {},
      { token }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to disconnect" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      revoked: result.revoked,
      eventsCleared: clearEvents ? eventsCleared : null,
      eventsLeft,
      message: eventsLeft
        ? "Google Calendar is disconnected, but some PERM deadline events couldn't be removed from your Google Calendar. Delete them there, since they won't be updated again."
        : result.revoked
          ? clearEvents
            ? `Google Calendar disconnected: ${eventsCleared.eventsDeleted} events removed from calendar`
            : "Google Calendar disconnected and OAuth token revoked"
          : "Google Calendar disconnected (token may have already been revoked)",
    });
  } catch (error) {
    console.error("[Google OAuth] Disconnect error:", error);
    captureError(error);
    return NextResponse.json(
      {
        error: "Failed to disconnect",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * Handle OPTIONS for CORS preflight (if needed)
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
