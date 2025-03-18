import React from 'react';

interface DetectionSettingsProps {
  sensitivity: 'low' | 'medium' | 'high';
  onChange: (sensitivity: 'low' | 'medium' | 'high') => void;
  className?: string;
}

const DetectionSettings: React.FC<DetectionSettingsProps> = ({ 
  sensitivity, 
  onChange, 
  className = '' 
}) => {
  // Function to get description text for current sensitivity
  const getSensitivityDescription = (): string => {
    if (sensitivity === 'low') return 'Better for clearly visible wounds with good contrast';
    if (sensitivity === 'medium') return 'Balanced detection for most skin types';
    return 'Better for subtle wounds or darker skin tones';
  };

  return (
    <div className={`bg-indigo-800/30 p-2 rounded-lg ${className}`}>
      <div className="flex flex-col">
        <label className="block text-sm font-medium text-indigo-300">
          Detection Sensitivity
        </label>
        <p className="text-xs text-indigo-300 mt-1">
          {getSensitivityDescription()}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => onChange('low')}
            className={`flex-1 text-xs px-2 py-1 rounded-md transition ${
              sensitivity === 'low' 
                ? 'bg-cyan-600 text-white' 
                : 'bg-indigo-800 text-indigo-300'
            }`}
          >
            Low
          </button>
          <button
            onClick={() => onChange('medium')}
            className={`flex-1 text-xs px-2 py-1 rounded-md transition ${
              sensitivity === 'medium' 
                ? 'bg-cyan-600 text-white' 
                : 'bg-indigo-800 text-indigo-300'
            }`}
          >
            Medium
          </button>
          <button
            onClick={() => onChange('high')}
            className={`flex-1 text-xs px-2 py-1 rounded-md transition ${
              sensitivity === 'high' 
                ? 'bg-cyan-600 text-white' 
                : 'bg-indigo-800 text-indigo-300'
            }`}
          >
            High
          </button>
        </div>
      </div>
    </div>
  );
};

export default DetectionSettings;
