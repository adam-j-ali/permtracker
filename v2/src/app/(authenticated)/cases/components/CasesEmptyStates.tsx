/**
 * The cases page with no cases at all. When filters match nothing, the page itself shows CaseListEmptyState in the
 * list's place, under the same filter bar, so a search that empties the list keeps the box and its focus.
 */

import { PlusIcon, UploadSimpleIcon } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { CaseListEmptyState } from "@/components/cases/CaseListEmptyState";

interface NewUserEmptyStateProps {
  onAddCase: () => void;
  isAddingCase: boolean;
  /** Opens the import: cases from a .csv or .json file. */
  onImport?: () => void;
}

export function NewUserEmptyState({ onAddCase, isAddingCase, onImport }: NewUserEmptyStateProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">Cases</h1>{" "}
          <p className="text-muted-foreground mt-1">0 total cases</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {onImport ? (
            <Button variant="outline" className="h-11" onClick={onImport}>
              <UploadSimpleIcon className="size-4 mr-2" aria-hidden="true" />
              Import cases
            </Button>
          ) : null}
          <Button
            onClick={onAddCase}
            loading={isAddingCase}
            loadingText="Adding..."
          >
            <PlusIcon className="size-4 mr-2" />
            Add case
          </Button>
        </div>
      </div>

      <CaseListEmptyState
        type="new-user"
        onAddCase={onAddCase}
      />
    </div>
  );
}
