"use client";

import { useState, useEffect } from "react";
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import type { Id } from "@convex/_generated/dataModel";

export type EditableField = "name" | "userType";

/** Each field's name, as its box and buttons say it. */
const FIELD_LABEL: Record<EditableField, string> = { name: "Name", userType: "Account type" };

export function InlineEdit({
  value,
  field,
  userId,
  onSave,
}: {
  value: string;
  field: EditableField;
  userId: Id<"users">;
  onSave: (userId: Id<"users">, field: EditableField, value: string) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);

  // Sync external value changes (real-time updates from Convex)
  useEffect(() => {
    if (!isEditing) {
      setEditValue(value);
    }
  }, [value, isEditing]);

  const handleSave = async () => {
    if (editValue === value) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      await onSave(userId, field, editValue);
      setIsEditing(false);
    } catch {
      // The save handler reports a failure (its own toast and error record); this only puts the old value back.
      setEditValue(value);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") handleCancel();
  };

  const label = FIELD_LABEL[field];
  const shown = field === "userType" ? value.replace(/_/g, " ") : value || "(empty)";

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        aria-label={`Edit ${label.toLowerCase()}: ${shown}`}
        className="w-full text-left px-1 py-0.5 -mx-1 hover:bg-accent hover:outline hover:outline-2 hover:outline-primary/30 transition-colors cursor-text truncate block max-w-[180px]"
        title="Click to edit"
      >
        {shown}
      </button>
    );
  }

  const buttons = (
    <>
      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        aria-label={`Save ${label.toLowerCase()}`}
        className="inline-flex size-11 shrink-0 items-center justify-center text-primary-text hover:bg-accent"
      >
        <CheckIcon className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={handleCancel}
        disabled={isSaving}
        aria-label="Cancel"
        className="inline-flex size-11 shrink-0 items-center justify-center text-destructive hover:bg-accent hover:text-destructive-text"
      >
        <XIcon className="size-4" aria-hidden="true" />
      </button>
    </>
  );

  if (field === "userType") {
    return (
      <div className="flex items-center gap-1">
        <select
          aria-label={label}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          disabled={isSaving}
          className="h-11 border-2 border-primary bg-background px-2 text-sm outline-none"
        >
          <option value="individual">individual</option>
        </select>
        {buttons}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        aria-label={label}
        placeholder="Type a value…"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        disabled={isSaving}
        className="h-11 w-full min-w-0 border-2 border-primary bg-background px-2 text-sm outline-none"
      />
      {buttons}
    </div>
  );
}
