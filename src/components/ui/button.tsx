import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "glow";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
          {
            "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow hover:from-indigo-600 hover:to-purple-700 hover:shadow-indigo-500/25":
              variant === "default",
            "bg-rose-600 text-white shadow-sm hover:bg-rose-700 hover:shadow-rose-600/25":
              variant === "destructive",
            "border border-slate-700 bg-slate-800/60 backdrop-blur-sm text-slate-200 hover:bg-slate-700 hover:text-white":
              variant === "outline",
            "bg-slate-800 text-slate-100 hover:bg-slate-700/80":
              variant === "secondary",
            "hover:bg-slate-800/80 text-slate-300 hover:text-white":
              variant === "ghost",
            "text-indigo-400 underline-offset-4 hover:underline":
              variant === "link",
            "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:from-indigo-400 hover:to-violet-500":
              variant === "glow",
            "h-10 px-4 py-2": size === "default",
            "h-8 rounded-lg px-3 text-xs": size === "sm",
            "h-12 rounded-xl px-6 text-base": size === "lg",
            "h-9 w-9 p-0": size === "icon",
          },
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
