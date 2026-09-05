import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  // `active:scale` is the press: on a phone it is the only acknowledgement a
  // 44px target gives before whatever it triggers happens, and on a mis-tap it
  // is forgiving rather than punishing. `--motion-instant` because feedback
  // that lags the finger reads as lag, not as feedback.
  "touch-manipulation inline-flex items-center justify-center whitespace-nowrap cursor-pointer rounded-md text-sm font-medium ring-offset-background transition-[colors,transform] duration-[var(--motion-instant)] active:scale-[0.955] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:active:scale-100",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground disabled:bg-primary/50 disabled:text-primary-foreground/90 hover:bg-primary/90",
        juicy: "bg-logo text-primary-foreground disabled:text-primary-foreground/50 hover:bg-logo/90",
        destructive: "bg-destructive-filled text-destructive-filled-foreground hover:bg-destructive-filled/90",
        outline:
          "border disabled:bg-transparent disabled:text-foreground/50 border-input disabled:border-input/90 bg-card hover:bg-muted hover:text-accent-foreground",
        secondary:
          "bg-transparent border border-border text-secondary-foreground hover:text-secondary-foreground/60 disabled:text-secondary-foreground/50",
        ghost: "hover:bg-accent dark:hover:bg-card hover:text-accent-foreground text-muted-foreground disabled:text-muted-foreground/50 border border-border/0 hover:border-border",
        link: "text-primary disabled:text-primary/50 underline-offset-4 hover:underline",
        none: "",
      },
      size: {
        default: "h-10 px-4 rounded-md py-2 max-md:min-h-11",
        sm: "h-9 rounded-md px-3 max-md:min-h-11",
        lg: "h-11 rounded-md px-8",
        icon: "h-9 w-9 rounded-md max-md:min-h-11 max-md:min-w-11",
        "icon-mobile": "h-11 w-11 rounded-md md:h-9 md:w-9",
        none: "",
        "icon-sm": "h-8 w-8 rounded-md max-md:min-h-11 max-md:min-w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> { }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => {
    return (
      <button
        type={type}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
