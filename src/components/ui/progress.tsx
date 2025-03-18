"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    indicatorClassName?: string;
  }
>(({ className, value, indicatorClassName, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={`relative h-2 w-full overflow-hidden rounded-full ${className}`}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={`h-full w-full flex-1 transition-all ${indicatorClassName || 'bg-indigo-500'}`}
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));

Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
