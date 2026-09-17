import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/format";
import Icon from "./Icon";

const control =
  "w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint outline-none transition-[border-color,box-shadow] duration-150 hover:border-brand-300 focus:border-brand-500 focus:shadow-focus disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-muted aria-[invalid=true]:border-bad";

export function Label({ children, hint, htmlFor, required }: { children: ReactNode; hint?: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-semibold text-ink">
      <span>
        {children}
        {required && <span className="ml-0.5 text-bad">*</span>}
      </span>
      {hint && <span className="font-normal text-ink-muted">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref
) {
  return <textarea ref={ref} className={cn(control, "min-h-[84px] resize-y py-2.5 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(control, "h-10 appearance-none pr-9", className)} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted" />
    </div>
  );
});

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1 text-xs text-bad" role="alert">
      <Icon name="info" size={13} /> {children}
    </p>
  );
}
