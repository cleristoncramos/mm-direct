interface ResetButtonProps {
    onResetButtonClick?: (e: React.FormEvent) => void;
    disabled?: boolean;
}

const ResetButton = ({ onResetButtonClick, disabled }: ResetButtonProps) => {
    return (
        <button 
            type="button" 
            onClick={onResetButtonClick}
            disabled={disabled}
            className={`w-32 py-1.5 px-4 font-bold text-xs uppercase tracking-wider transition-all rounded-none ${
                disabled 
                    ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-60" 
                    : "bg-slate-700 hover:bg-slate-600 active:bg-slate-800 text-slate-200 shadow-sm cursor-pointer"
            }`}
        >
            Reset
        </button>
    );
};

export default ResetButton;
