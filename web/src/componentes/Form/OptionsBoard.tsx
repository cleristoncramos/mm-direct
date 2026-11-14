import { useEffect, useState } from "react";

interface OptionsBoardProps {
    children: React.ReactNode;
    BoardHeader: string;
    defaultOpen?: boolean;
    hasErrors?: boolean;
    isDisabled?: boolean;
}

const OptionsBoard = ({
    children,
    BoardHeader,
    defaultOpen = false,
    hasErrors = false,
    isDisabled = false
}: OptionsBoardProps) => {
    // As seções começam fechadas; o usuário abre só as que quiser ajustar.
    const [isOpen, setIsOpen] = useState(defaultOpen);

    // Exceção: se um campo da seção ficar inválido, ela abre para o erro não ficar escondido.
    useEffect(() => {
        if (hasErrors) setIsOpen(true);
    }, [hasErrors]);

    const handleToggle = (e: React.MouseEvent) => {
        e.preventDefault();
        if (isDisabled) return;
        setIsOpen(!isOpen);
    };

    return (
        <div className={`w-full mb-2 border border-slate-800 transition-colors ${
            isOpen ? 'bg-slate-800/30 border-l-2 border-l-blue-500' : 'bg-slate-900/60 hover:bg-slate-800/20'
        } ${hasErrors ? 'border-rose-500/50 border-l-2 border-l-rose-500' : ''}`}>
            <button 
                type="button" 
                onClick={handleToggle}
                className="w-full flex justify-between items-center px-3 py-2 text-left focus:outline-none focus:ring-1 focus:ring-blue-500/50 group"
                disabled={isDisabled}
            >
                <div className="flex items-center space-x-2">
                    <h3 className={`font-semibold text-xs uppercase tracking-wider transition-colors ${
                        hasErrors 
                            ? 'text-rose-400' 
                            : (isOpen ? 'text-blue-400' : 'text-slate-300 group-hover:text-blue-400')
                    }`}>
                        {BoardHeader}
                    </h3>
                    {hasErrors && (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            Invalid
                        </span>
                    )}
                </div>
                <svg 
                    className={`w-4 h-4 text-slate-400 group-hover:text-blue-400 transition-transform duration-300 ${isOpen ? 'rotate-180 text-blue-400' : ''}`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            
            <div className={`transition-all duration-300 ease-in-out px-3 ${
                isOpen ? 'max-h-[2000px] opacity-100 py-2 border-t border-slate-800/60' : 'max-h-0 opacity-0 py-0 overflow-hidden border-t-0'
            }`}>
                {children}
            </div>
        </div>
    );
};

export default OptionsBoard;
