"use client";

// `convex/react` is a CLIENT-ONLY module: its hooks reach `React.createContext`,
// which exists only in React's client build. Declared here rather
// than inherited from whichever importer happened to cross a boundary first.
// Without it this module works until the chunk graph shifts, then fails with
// `TypeError: (0 , d.createContext) is not a function` naming webpack bootstrap
// and no source file. See components/layout/Footer.tsx.

/**
 * ChatHistory Component
 *
 * Slide-out panel showing conversation list.
 * Allows switching between conversations and creating new ones.
 *
 * @module components/chat/ChatHistory
 */

'use client';

import { useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { Button } from '@/components/ui/button';
import { ChatTextIcon, CircleNotchIcon, PlusIcon, TrashIcon as Trash2, XIcon } from "@phosphor-icons/react/ssr";
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Id } from '@convex/_generated/dataModel';
import { useAuthContext } from '@/lib/contexts/AuthContext';
import { CHAT_LIMITS } from '@convex/lib/chatLimits';
import { handleOperationError } from '@/lib/errors';
import { useFocusNext } from '@/components/ui/use-focus-next';

/**
 * Conversations shown per page. The list grows with every conversation the
 * person starts, so it shows a page at a time with the total and what is left.
 */
const HISTORY_PAGE = 30;

interface ChatHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  currentConversationId: Id<'conversations'> | null;
  onSelectConversation: (id: Id<'conversations'>) => void;
  onNewConversation: () => unknown;
}

/**
 * A Radix dialog: focus stays inside while it's open, Escape and a click
 * outside close it, and focus goes back to the history button. Each
 * conversation is a button, so a keyboard can open one.
 */
export function ChatHistory({
  isOpen,
  onClose,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
}: ChatHistoryProps) {
  const { isSigningOut } = useAuthContext();

  // Skip query during sign-out to prevent "not authenticated" errors
  const conversations = useQuery(
    api.conversations.list,
    isSigningOut ? 'skip' : {}
  );
  const [shown, setShown] = useState(HISTORY_PAGE);
  const deleteConversation = useMutation(api.conversations.deleteConversation);
  const deleteAllConversations = useMutation(api.conversations.deleteAll);
  // The list holds the newest CHAT_LIMITS.conversationsListed; at that length
  // there may be older ones it doesn't show, and it says so.
  const atListLimit = (conversations?.length ?? 0) >= CHAT_LIMITS.conversationsListed;

  // A delete asks with a second press in the panel, never a browser dialog that blocks the page. Each press swaps
  // buttons, so focus moves to what replaced the pressed one.
  const [sureId, setSureId] = useState<Id<'conversations'> | null>(null);
  const [sureAll, setSureAll] = useState(false);
  const focusNext = useFocusNext();
  const keepRef = useRef<HTMLButtonElement>(null);
  const keepAllRef = useRef<HTMLButtonElement>(null);
  const deleteAllRef = useRef<HTMLButtonElement>(null);
  const trashRefs = useRef(new Map<string, HTMLButtonElement>());

  const startNew = () => {
    Promise.resolve(onNewConversation()).catch((err: unknown) => {
      console.error('[ChatHistory] Could not start a new conversation:', err instanceof Error ? err.message : err);
    });
  };

  const handleDeleteAll = async () => {
    setSureAll(false);
    try {
      await deleteAllConversations({});
    } catch (error) {
      handleOperationError(error, { userMessage: "Couldn’t delete your conversations. Try again." });
      return;
    }
    startNew();
  };

  const handleDelete = (id: Id<'conversations'>) => {
    setSureId(null);
    deleteConversation({ id }).catch((error: unknown) =>
      handleOperationError(error, { userMessage: "Couldn’t delete that conversation. Try again." }),
    );
  };

  const allQuestion = atListLimit
    ? "Delete all your conversations permanently? This can't be undone."
    : `Delete all ${conversations?.length ?? 0} conversation${(conversations?.length ?? 0) > 1 ? 's' : ''} permanently? This can't be undone.`;

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none"
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'ph-no-capture',
            'fixed right-0 top-0 bottom-0 z-[61]',
            'w-80 max-w-[85vw] pr-[env(safe-area-inset-right,0px)]',
            'bg-background border-l-2 border-border shadow-hard-lg',
            'flex flex-col focus:outline-none',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right motion-reduce:animate-none'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b-2 border-border">
            <div className="min-w-0">
              <DialogPrimitive.Title className="font-heading font-semibold">Chat history</DialogPrimitive.Title>{" "}
              {conversations && conversations.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {atListLimit
                    ? `Your ${conversations.length.toLocaleString('en-US')} most recent conversations`
                    : `${conversations.length.toLocaleString('en-US')} conversation${conversations.length === 1 ? '' : 's'}`}
                </p>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" className="h-11 w-11 md:h-9 md:w-9" aria-label="Close history">
                <XIcon className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {/* New Conversation Button */}
          <div className="p-4 border-b-2 border-border">
            <Button
              onClick={() => {
                startNew();
                onClose();
              }}
              className="w-full shadow-hard-sm"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              New conversation
            </Button>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {conversations === undefined ? (
              // Loading is not empty: the list says so instead of "No conversations yet" (owner, Nov 2 2026).
              <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <CircleNotchIcon aria-hidden="true" weight="bold" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
                Loading your conversations…
              </div>
            ) : !conversations || conversations.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <ChatTextIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No conversations yet</p>
              </div>
            ) : (
              conversations.slice(0, shown).map((conv) => {
                const isCurrent = conv._id === currentConversationId;
                return (
                  <div key={conv._id} className="group relative">
                    <button
                      type="button"
                      aria-current={isCurrent ? 'true' : undefined}
                      className={cn(
                        'block w-full text-left p-3 pr-16 border-2 border-border',
                        'transition-colors duration-150',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isCurrent
                          ? 'border-primary bg-tint'
                          : 'border-border hover:border-primary/50 hover:bg-muted/50'
                      )}
                      onClick={() => {
                        onSelectConversation(conv._id);
                        onClose();
                      }}
                    >
                      <span className="block font-medium text-sm truncate" title={conv.title}>
                        {conv.title}
                      </span>{" "}
                      <span className="block text-sm text-muted-foreground mt-1">
                        {formatDistanceToNow(conv.updatedAt, { addSuffix: true })}
                      </span>
                    </button>

                    {/* Delete: beside the row, never inside its button. Shown
                        on hover and keyboard focus on a desk, always on a phone. */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100 transition-opacity">
                      <Button
                        ref={(el) => {
                          if (el) trashRefs.current.set(conv._id, el);
                          else trashRefs.current.delete(conv._id);
                        }}
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 md:h-9 md:w-9 text-destructive hover:text-destructive-text"
                        onClick={() => {
                          focusNext(() => keepRef.current);
                          setSureId(conv._id);
                        }}
                        aria-label={`Delete conversation ${conv.title}`}
                        aria-expanded={sureId === conv._id}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                    {sureId === conv._id ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2 border-2 border-destructive/40 bg-background p-2">
                        <span className="text-sm">Delete this conversation permanently?</span>{" "}
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="h-11 md:h-9"
                          aria-label={`Delete ${conv.title} for good`}
                          onClick={() => handleDelete(conv._id)}
                        >
                          Delete
                        </Button>{" "}
                        <Button
                          ref={keepRef}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 md:h-9"
                          onClick={() => {
                            const id = conv._id;
                            focusNext(() => trashRefs.current.get(id) ?? null);
                            setSureId(null);
                          }}
                        >
                          Keep it
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
            {conversations && conversations.length > shown && (() => {
              const left = conversations.length - shown;
              const next = Math.min(HISTORY_PAGE, left);
              return (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 md:h-9 shadow-hard-sm"
                  onClick={() => setShown((n) => n + HISTORY_PAGE)}
                >
                  {next === left ? `Show ${next} more` : `Show ${next} more (${left} left)`}
                </Button>
              );
            })()}
            {atListLimit && conversations && shown >= conversations.length && (
              <p className="text-sm text-muted-foreground">
                Older conversations aren&rsquo;t listed here. A conversation is deleted 90 days after its last message.
              </p>
            )}
          </div>

          {/* Delete All Footer */}
          {conversations && conversations.length > 0 && (
            <div className="p-4 border-t-2 border-border">
              {sureAll ? (
                <div className="space-y-2">
                  <p className="text-sm">{allQuestion}</p>{" "}
                  <div className="flex gap-2">
                    <Button variant="destructive" className="flex-1" onClick={() => void handleDeleteAll()}>
                      Delete all for good
                    </Button>{" "}
                    <Button
                      ref={keepAllRef}
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        focusNext(() => deleteAllRef.current);
                        setSureAll(false);
                      }}
                    >
                      Keep them
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  ref={deleteAllRef}
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    focusNext(() => keepAllRef.current);
                    setSureAll(true);
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                  Delete all conversations
                </Button>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
