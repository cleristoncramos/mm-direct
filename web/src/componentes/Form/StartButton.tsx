interface StartButtonProps {
    onClickButton?: (e: React.FormEvent) => void;
    disabled?: boolean;
}

const StartButton = ({ onClickButton, disabled }: StartButtonProps) => {
    return (
        <button 
            type="submit" 
            onClick={onClickButton}
            disabled={disabled}
            className={`w-32 py-1.5 px-4 font-bold text-xs uppercase tracking-wider transition-all rounded-none ${
                disabled 
                    ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-60" 
                    : "bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-lg cursor-pointer"
            }`}
        >
            Start
        </button>
    );
};

export default StartButton;
