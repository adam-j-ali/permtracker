// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * The history list grows with every conversation the person starts, so it
 * shows a page at a time, says how many there are, and says how many are left.
 */

const many = Array.from({ length: 73 }, (_, i) => ({
  _id: `c${i}`,
  title: `Conversation ${i + 1}`,
  updatedAt: Date.UTC(2026, 8, 29) - i * 60_000,
}));
let list: typeof many | undefined = many;

const mutation = vi.hoisted(() => ({ fn: (() => Promise.resolve(null)) as (...a: unknown[]) => Promise<unknown> }));
vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => list),
  useMutation: vi.fn(() => (...a: unknown[]) => mutation.fn(...a)),
}));
const handleOperationError = vi.fn();
vi.mock('@/lib/errors', () => ({ handleOperationError: (...a: unknown[]) => handleOperationError(...a) }));
vi.mock('@/lib/contexts/AuthContext', () => ({
  useAuthContext: () => ({ isSigningOut: false }),
}));

import { ChatHistory } from '../ChatHistory';

const props = {
  isOpen: true,
  onClose: () => {},
  currentConversationId: null,
  onSelectConversation: () => {},
  onNewConversation: () => {},
};

describe('ChatHistory', () => {
  it('shows the first page, the total, and a button for the rest', () => {
    list = many;
    render(<ChatHistory {...props} />);
    expect(screen.getByText('73 conversations')).toBeInTheDocument();
    expect(screen.getByText('Conversation 30')).toBeInTheDocument();
    expect(screen.queryByText('Conversation 31')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show 30 more (43 left)' }));
    expect(screen.getByText('Conversation 60')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 13 more' }));
    expect(screen.getByText('Conversation 73')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument();
  });

  it('shows no paging for a short list', () => {
    list = many.slice(0, 3);
    render(<ChatHistory {...props} />);
    expect(screen.getByText('3 conversations')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument();
  });

  it('keeps the delete button reachable without a mouse', () => {
    list = many.slice(0, 1);
    render(<ChatHistory {...props} />);
    const del = screen.getByRole('button', { name: 'Delete conversation Conversation 1' });
    // Shown on keyboard focus and on touch screens, not only on hover.
    expect(del.parentElement!.className).toMatch(/group-focus-within:opacity-100/);
    expect(del.parentElement!.className).toMatch(/max-md:opacity-100/);
  });

  // A keyboard can open a past conversation: each row is a button (they were
  // clickable divs), and the open one says so (Oct 12 2026).
  it('opens a conversation from a button, and marks the current one', () => {
    list = many.slice(0, 2);
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ChatHistory {...props} currentConversationId={'c1' as never} onSelectConversation={onSelect} onClose={onClose} />);
    const row = screen.getByRole('button', { name: /^Conversation 1 / });
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('c0');
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Conversation 2 / })).toHaveAttribute('aria-current', 'true');
  });

  it('is a dialog named Chat history that Escape closes', () => {
    list = many.slice(0, 2);
    const onClose = vi.fn();
    render(<ChatHistory {...props} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Chat history' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('says when it lists only the newest conversations', () => {
    list = Array.from({ length: 200 }, (_, i) => ({ _id: `c${i}`, title: `Conversation ${i + 1}`, updatedAt: Date.UTC(2026, 8, 29) - i * 60_000 }));
    render(<ChatHistory {...props} />);
    expect(screen.getByText('Your 200 most recent conversations')).toBeInTheDocument();
  });

  it('says the list is loading, never "No conversations yet" while it loads', () => {
    list = undefined;
    render(<ChatHistory {...props} />);
    expect(screen.getByText('Loading your conversations…')).toBeInTheDocument();
    expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument();
    list = many;
  });

  // Deleting asks with a second press in the panel itself, never a browser dialog that blocks the page.
  it('deletes a conversation only on a second press, with focus kept on the row', async () => {
    // Arrange
    list = many.slice(0, 2);
    const calls: unknown[] = [];
    mutation.fn = (...a: unknown[]) => {
      calls.push(a[0]);
      return Promise.resolve(null);
    };
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<ChatHistory {...props} />);
    // Act: the first press only asks, and focus moves to Keep it
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation Conversation 1' }));
    // Assert
    expect(calls).toEqual([]);
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();
    // Backing out hands focus back to the trash button
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Delete conversation Conversation 1' })).toHaveFocus();
    // Asking again and confirming deletes that conversation
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation Conversation 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Conversation 1 for good' }));
    await vi.waitFor(() => expect(calls).toEqual([{ id: 'c0' }]));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('deletes them all only on a second press, then starts a new conversation', async () => {
    // Arrange
    list = many.slice(0, 2);
    const calls: unknown[] = [];
    mutation.fn = (...a: unknown[]) => {
      calls.push(a[0]);
      return Promise.resolve(null);
    };
    const onNewConversation = vi.fn();
    render(<ChatHistory {...props} onNewConversation={onNewConversation} />);
    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Delete all conversations' }));
    // Assert: it says what it will do, and focus waits on Keep them
    expect(calls).toEqual([]);
    expect(screen.getByText("Delete all 2 conversations permanently? This can't be undone.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep them' })).toHaveFocus();
    // Act: confirm
    fireEvent.click(screen.getByRole('button', { name: 'Delete all for good' }));
    // Assert
    await vi.waitFor(() => expect(calls).toEqual([{}]));
    await vi.waitFor(() => expect(onNewConversation).toHaveBeenCalled());
  });

  it('says so when a delete fails, one conversation or all of them, and starts nothing new', async () => {
    // Arrange
    list = many.slice(0, 2);
    mutation.fn = () => Promise.reject(new Error('offline'));
    const onNewConversation = vi.fn();
    render(<ChatHistory {...props} onNewConversation={onNewConversation} />);
    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation Conversation 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Conversation 1 for good' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete all conversations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete all for good' }));
    // Assert
    await vi.waitFor(() => expect(handleOperationError).toHaveBeenCalledTimes(2));
    expect(onNewConversation).not.toHaveBeenCalled();
    mutation.fn = () => Promise.resolve(null);
  });
});
