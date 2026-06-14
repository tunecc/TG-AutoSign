import { Trash, X, CheckSquare, Square } from "@phosphor-icons/react";

interface TaskBatchActionsBarProps {
  selectedCount: number;
  totalCount: number;
  isAllSelected: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBatchDelete: () => void;
  deleteLabel: string;
  clearLabel: string;
  selectAllLabel: string;
  selectedLabel: string;
}

export const TaskBatchActionsBar = ({
  selectedCount,
  totalCount,
  isAllSelected,
  onSelectAll,
  onClearSelection,
  onBatchDelete,
  deleteLabel,
  clearLabel,
  selectAllLabel,
  selectedLabel,
}: TaskBatchActionsBarProps) => {
  return (
    <div className="glass-panel p-3 flex items-center justify-between gap-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <button
          onClick={onSelectAll}
          className="action-btn !w-8 !h-8"
          title={selectAllLabel}
        >
          {isAllSelected ? (
            <CheckSquare weight="fill" size={18} />
          ) : (
            <Square weight="bold" size={18} />
          )}
        </button>
        <span className="text-sm font-bold">
          {selectedLabel.replace("{count}", selectedCount.toString()).replace("{total}", totalCount.toString())}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onBatchDelete}
          disabled={selectedCount === 0}
          className="px-4 py-2 rounded-xl font-bold text-xs transition-all bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2">
            <Trash weight="bold" size={14} />
            {deleteLabel}
          </div>
        </button>
        <button
          onClick={onClearSelection}
          className="action-btn"
          title={clearLabel}
        >
          <X weight="bold" size={18} />
        </button>
      </div>
    </div>
  );
};
