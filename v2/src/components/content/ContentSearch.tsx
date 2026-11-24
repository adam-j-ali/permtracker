"use client";

/**
 * ContentSearch
 *
 * The article listings' filter box: filters posts by title and description,
 * with a clear button once something is typed. Empty and focused, it offers
 * the visitor's recent searches; a search is kept on Enter or on leaving the
 * box, and a listing opened from one starts filtered by it.
 */

import { MagnifyingGlassIcon as Search, XIcon } from "@phosphor-icons/react";

import { RecentSearchesField } from "@/components/search/RecentSearches";

interface ContentSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function ContentSearch({
  value,
  onChange,
  placeholder = "Search articles...",
}: ContentSearchProps) {
  return (
    <RecentSearchesField record="filter" value={value} onRestore={onChange} restoreFromUrl>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        aria-label="Search articles"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 border-2 border-input bg-card py-2.5 pl-10 pr-12 text-base transition-colors [&::-webkit-search-cancel-button]:appearance-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus:border-primary focus:shadow-hard-sm"
      />
      {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            /* The tap target was the 16px icon itself. 44px is the floor, and
               a clear button that is hard to hit on a phone is a control that
               reads as broken rather than small. The glyph stays where it was;
               only the hit area around it grew, and the input's right padding
               went to `pr-12` so text cannot run underneath it. */
            className="absolute right-0.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Clear search"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
    </RecentSearchesField>
  );
}
