import React from 'react';

interface SensitivityToggleProps {
  sensitivity: 'low' | 'medium' | 'high';
  onChange: (sensitivity: 'low' | 'medium' | 'high') => void;
  className?: string;
}

const SensitivityToggle: React.FC<SensitivityToggleProps> = ({ 
  sensitivity, 
  onChange, 
  className = '' 
}) => {
  // Function to get description text for current sensitivity
  const getSensitivityDescription = (): string => {
    if (sensitivity === 'low') return 'Low: Better for clearly visible wounds with good contrast';
    if (sensitivity === 'medium') return 'Medium: Balanced detection for most skin types';
    return 'High: Better for subtle wounds or darker skin tones';
  };

  return (
    <div className={`bg-indigo-800/30 p-2 rounded-lg ${className}`}>
      <div>
        <label className="block text-sm font-medium mb-2 text-indigo-300">
          Detection Sensitivity
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-indigo-300">Low</span>
          <div className="flex-1">
            <input
              type="range"
              min="1"
              max="3"
              step="1"
              value={sensitivity === 'low' ? 1 : sensitivity === 'medium' ? 2 : 3}
              onChange={(e) => {
                const value = parseInt(e.target.value);
                if (value === 1) onChange('low');
                else if (value === 2) onChange('medium');
                else onChange('high');
              }}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-indigo-800"
            />
          </div>
          <span className="text-xs text-indigo-300">High</span>
        </div>
        <p className="text-xs text-indigo-300 mt-1">
          {getSensitivityDescription()}
        </p>
      </div>
    </div>
  );
};

export default SensitivityToggle;
