/**
 * Peças de interface do shell (menus, popovers e diálogos) no visual do
 * MonkeyCord, em cima do Base UI.
 */
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { ContextMenu as CtxPrimitive } from "@base-ui/react/context-menu";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const popupBase =
  "z-50 origin-(--transform-origin) rounded-lg border border-white/8 bg-popover text-sm text-foreground shadow-2xl shadow-black/60 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

type Side = "top" | "bottom" | "left" | "right";

/** Menu que abre num botão. */
export function Menu({
  trigger,
  children,
  side = "bottom",
  align = "start",
  className,
}: {
  trigger: ReactElement;
  children: ReactNode;
  side?: Side;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger render={trigger} />
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner side={side} align={align} sideOffset={6} className="z-50">
          <MenuPrimitive.Popup className={cn(popupBase, "min-w-52 p-1.5", className)}>{children}</MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

/** Menu do botão direito. */
export function ContextMenu({ children, menu, disabled }: { children: ReactElement; menu: ReactNode; disabled?: boolean }) {
  if (disabled) return children;
  return (
    <CtxPrimitive.Root>
      <CtxPrimitive.Trigger render={children} />
      <CtxPrimitive.Portal>
        <CtxPrimitive.Positioner className="z-50">
          <CtxPrimitive.Popup className={cn(popupBase, "min-w-52 p-1.5")}>{menu}</CtxPrimitive.Popup>
        </CtxPrimitive.Positioner>
      </CtxPrimitive.Portal>
    </CtxPrimitive.Root>
  );
}

const itemClass =
  "flex h-8 w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 text-left text-sm font-medium outline-none select-none data-highlighted:bg-white/10 data-disabled:cursor-default data-disabled:opacity-40";

export function MenuItem({
  danger,
  icon,
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { danger?: boolean; icon?: ReactNode }) {
  return (
    <MenuPrimitive.Item
      className={cn(itemClass, danger ? "text-destructive data-highlighted:bg-destructive data-highlighted:text-white" : "text-foreground/90", className)}
      {...props}
    >
      <span className="truncate">{children as ReactNode}</span>
      {icon && <span className="flex shrink-0 [&_svg]:size-4.5">{icon}</span>}
    </MenuPrimitive.Item>
  );
}

export function MenuRadio<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; hint?: string }[];
}) {
  return (
    <MenuPrimitive.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
      {options.map((o) => (
        <MenuPrimitive.RadioItem key={o.value} value={o.value} className={cn(itemClass, "h-auto min-h-8 py-1.5 text-foreground/90")}>
          <span className="min-w-0">
            <span className="block">{o.label}</span>
            {o.hint && <span className="block text-xs font-normal text-muted-foreground">{o.hint}</span>}
          </span>
          <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full border-2 border-white/30">
            <MenuPrimitive.RadioItemIndicator>
              <Check className="size-3" strokeWidth={3} />
            </MenuPrimitive.RadioItemIndicator>
          </span>
        </MenuPrimitive.RadioItem>
      ))}
    </MenuPrimitive.RadioGroup>
  );
}

export function MenuSeparator() {
  return <MenuPrimitive.Separator className="mx-1.5 my-1 h-px bg-white/8" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <MenuPrimitive.Group>
      <MenuPrimitive.GroupLabel className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {children}
      </MenuPrimitive.GroupLabel>
    </MenuPrimitive.Group>
  );
}

/** Caixa flutuante presa num elemento (perfil, fixadas, emojis). */
export function Popover({
  trigger,
  children,
  side = "bottom",
  align = "center",
  open,
  onOpenChange,
  className,
}: {
  trigger: ReactElement;
  children: ReactNode;
  side?: Side;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(o) => onOpenChange?.(o)}>
      <PopoverPrimitive.Trigger render={trigger} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side={side} align={align} sideOffset={8} collisionPadding={12} className="z-50">
          <PopoverPrimitive.Popup className={cn(popupBase, className)}>{children}</PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Janela no meio da tela (criar canal, confirmar exclusão). */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/70 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-white/8 bg-popover shadow-2xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <div className="p-4">
            <DialogPrimitive.Title className="text-xl font-bold">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
            )}
            {children && <div className="mt-4">{children}</div>}
          </div>
          {footer && <div className="flex justify-end gap-2 bg-black/25 px-4 py-3">{footer}</div>}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ModalButton({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: "primary" | "danger" | "ghost" }) {
  return (
    <button
      type="button"
      className={cn(
        "h-9 rounded-md px-4 text-sm font-semibold transition disabled:opacity-50",
        variant === "primary" && "bg-foreground text-background hover:bg-foreground/85",
        variant === "danger" && "bg-destructive text-white hover:bg-destructive/85",
        variant === "ghost" && "text-foreground/80 hover:underline",
        className
      )}
      {...props}
    />
  );
}
