import type { HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  pill?: boolean;
  innerClassName?: string;
};

export function GradientCard({ children, pill, className, innerClassName, ...rest }: Props) {
  return (
    <div {...rest} className={`grad-border ${pill ? "grad-border-pill" : ""} ${className ?? ""}`}>
      <div className={`grad-border-inner ${innerClassName ?? ""}`}>{children}</div>
    </div>
  );
}
