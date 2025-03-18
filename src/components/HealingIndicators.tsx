import React from 'react';
import { Progress } from '@/components/ui/progress';
import { 
  AlertCircle, 
  ThermometerSun, 
  Layers, 
  TrendingUp, 
  TrendingDown,
  ShieldAlert,
  Check,
  CircleDot
} from 'lucide-react';

interface HealingIndicatorsProps {
  inflammationScore: number;
  exudateScore: number;
  rednessRatio: number;
  tissueTypes: {
    granulation: number;
    slough: number;
    eschar: number;
  };
  className?: string;
}

export const HealingIndicators: React.FC<HealingIndicatorsProps> = ({
  inflammationScore,
  exudateScore,
  rednessRatio,
  tissueTypes,
  className = ''
}) => {
  // Convert scores to percentages for display
  const inflammationPercentage = Math.min(100, Math.round(inflammationScore * 100));
  const exudatePercentage = Math.min(100, Math.round(exudateScore * 100));
  
  // Normalize redness ratio for display
  const normalizedRednessRatio = Math.min(2, Math.max(0.5, rednessRatio));
  const rednessPercentage = Math.round((normalizedRednessRatio - 0.5) * 100 / 1.5);
  
  // Convert tissue types to percentages
  const granulationPercentage = Math.round(tissueTypes.granulation * 100);
  const sloughPercentage = Math.round(tissueTypes.slough * 100);
  const escharPercentage = Math.round(tissueTypes.eschar * 100);
  
  // Determine healing status based on tissue composition and inflammation
  const getHealingStatus = () => {
    // Higher granulation tissue is good
    if (granulationPercentage > 70 && inflammationPercentage < 40 && exudatePercentage < 20) {
      return { text: 'Good Healing', color: 'text-emerald-400', icon: <Check className="h-4 w-4" /> };
    }
    // High inflammation or exudate indicates potential issues
    if (inflammationPercentage > 60 || exudatePercentage > 50 || escharPercentage > 30) {
      return { text: 'Needs Attention', color: 'text-rose-400', icon: <ShieldAlert className="h-4 w-4" /> };
    }
    // Default moderate status
    return { text: 'Progressing', color: 'text-amber-400', icon: <CircleDot className="h-4 w-4" /> };
  };
  
  const status = getHealingStatus();
  
  // Get appropriate colors for the indicators
  const getInflammationColor = () => {
    if (inflammationPercentage < 30) return 'bg-emerald-500';
    if (inflammationPercentage < 60) return 'bg-amber-500';
    return 'bg-rose-500';
  };
  
  const getExudateColor = () => {
    if (exudatePercentage < 20) return 'bg-emerald-500';
    if (exudatePercentage < 50) return 'bg-amber-500';
    return 'bg-rose-500';
  };
  
  const getRednessColor = () => {
    if (rednessPercentage < 30) return 'bg-emerald-500';
    if (rednessPercentage < 60) return 'bg-amber-500';
    return 'bg-rose-500';
  };
  
  return (
    <div className={`bg-indigo-900/30 rounded-lg p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-indigo-200">Healing Indicators</h4>
        <div className={`text-xs flex items-center gap-1 ${status.color} font-medium`}>
          {status.icon}
          {status.text}
        </div>
      </div>
      
      <div className="space-y-3">
        {/* Inflammation indicator */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs">
            <div className="flex items-center gap-1 text-indigo-300">
              <ThermometerSun size={14} className="text-rose-400" />
              <span>Inflammation</span>
            </div>
            <span className="text-white">{inflammationPercentage}%</span>
          </div>
          <Progress value={inflammationPercentage} className="h-1 bg-indigo-950/50" indicatorClassName={getInflammationColor()} />
        </div>
        
        {/* Exudate/pus indicator */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs">
            <div className="flex items-center gap-1 text-indigo-300">
              <Layers size={14} className="text-amber-400" />
              <span>Exudate</span>
            </div>
            <span className="text-white">{exudatePercentage}%</span>
          </div>
          <Progress value={exudatePercentage} className="h-1 bg-indigo-950/50" indicatorClassName={getExudateColor()} />
        </div>
        
        {/* Redness ratio indicator */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs">
            <div className="flex items-center gap-1 text-indigo-300">
              <AlertCircle size={14} className="text-cyan-400" />
              <span>Redness vs. Skin</span>
            </div>
            <div className="flex items-center gap-1 text-white">
              {normalizedRednessRatio.toFixed(2)}x
              {rednessRatio > 1.2 ? 
                <TrendingUp size={12} className="text-rose-400" /> :
                <TrendingDown size={12} className="text-emerald-400" />
              }
            </div>
          </div>
          <Progress value={rednessPercentage} className="h-1 bg-indigo-950/50" indicatorClassName={getRednessColor()} />
        </div>
      </div>
      
      {/* Tissue composition donut chart */}
      <div className="mt-3">
        <div className="flex justify-between items-center text-xs mb-1">
          <span className="text-indigo-300">Tissue Composition</span>
        </div>
        <div className="flex gap-1">
          <div 
            className="h-4 bg-emerald-500 rounded-l-sm" 
            style={{ width: `${granulationPercentage}%` }}
            title={`Granulation: ${granulationPercentage}%`}
          />
          <div 
            className="h-4 bg-amber-500" 
            style={{ width: `${sloughPercentage}%` }}
            title={`Slough: ${sloughPercentage}%`}
          />
          <div 
            className="h-4 bg-gray-700 rounded-r-sm" 
            style={{ width: `${escharPercentage}%` }}
            title={`Eschar/Necrotic: ${escharPercentage}%`}
          />
        </div>
        <div className="flex justify-between text-[10px] mt-1 text-indigo-300">
          <span className="flex items-center gap-0.5">
            <span className="w-2 h-2 bg-emerald-500 rounded-sm inline-block"></span> Granulation
          </span>
          <span className="flex items-center gap-0.5">
            <span className="w-2 h-2 bg-amber-500 rounded-sm inline-block"></span> Slough
          </span>
          <span className="flex items-center gap-0.5">
            <span className="w-2 h-2 bg-gray-700 rounded-sm inline-block"></span> Eschar
          </span>
        </div>
      </div>
    </div>
  );
};

export default HealingIndicators;
