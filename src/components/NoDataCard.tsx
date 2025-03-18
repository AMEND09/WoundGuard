import React from 'react';
import { AlertCircle } from 'lucide-react';

interface NoDataCardProps {
  message: string;
  hint?: string;
  className?: string;
}

const NoDataCard: React.FC<NoDataCardProps> = ({ 
  message, 
  hint = "Data will appear here once available",
  className = "" 
}) => {
  return (
    <div className={`flex flex-col items-center justify-center p-6 bg-indigo-900/20 border border-dashed border-indigo-700 rounded-lg ${className}`}>
      <AlertCircle className="text-indigo-500 mb-2 h-8 w-8 opacity-70" />
      <p className="text-indigo-300 text-sm text-center font-medium">{message}</p>
      {hint && (
        <p className="text-indigo-400 text-xs text-center mt-1 opacity-70">{hint}</p>
      )}
    </div>
  );
};

export default NoDataCard;
