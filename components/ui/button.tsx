import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Stoop buttons: pills. `default` is the one brick primary action per view (ink label for AA).
// `outline` and `ghost` keep their shadcn names because Dialog and Sheet use them internally.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border-2 border-transparent bg-clip-padding font-semibold whitespace-nowrap transition-[transform,box-shadow,background-color,color] duration-200 ease-(--ease-smooth) outline-none select-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-ink bg-brick text-ink shadow-pop hover:-translate-y-px hover:shadow-[0_3px_0_var(--color-ink)] active:translate-y-px active:shadow-none",
        outline: "border-ink bg-paper-raised text-ink hover:bg-sand aria-expanded:bg-sand",
        secondary: "border-ink bg-paper-raised text-ink hover:bg-sand aria-expanded:bg-sand",
        // App register: the calm outlined button on white cards (copy, download, secondary actions).
        quiet: "border-[1.5px] border-concrete-line bg-surface text-ink hover:bg-fill aria-expanded:bg-fill",
        screen: "border-paper/20 bg-screen-raised text-paper hover:bg-paper/10",
        ghost: "text-current hover:bg-ink/5 aria-expanded:bg-ink/5",
        destructive: "border-rose-deep bg-rose-soft text-rose-deep hover:bg-rose-soft/70",
        link: "rounded-none border-0 px-0 text-current underline decoration-2 underline-offset-4 hover:decoration-brick",
      },
      size: {
        default: "h-11 gap-2 px-5 text-[0.95rem] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xs: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-4 text-sm [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-13 gap-2 px-7 text-base",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
