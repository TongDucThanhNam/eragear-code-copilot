"use client";

import {
  CheckIcon,
  ChevronsUpDownIcon,
  CircleIcon,
  Loader2Icon,
} from "lucide-react";
import type { ComponentProps } from "react";
import { createContext, useContext } from "react";
import { Button } from "@/components/ui/button";
import {
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Shimmer } from "./shimmer";

type PlanContextValue = {
  isStreaming: boolean;
};

const PlanContext = createContext<PlanContextValue | null>(null);

const usePlan = () => {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error("Plan components must be used within Plan");
  }
  return context;
};

export type PlanProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
};

export const Plan = ({
  className,
  isStreaming = false,
  children,
  ...props
}: PlanProps) => (
  <PlanContext.Provider value={{ isStreaming }}>
    <Collapsible
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow-none",
        className
      )}
      data-slot="plan"
      {...props}
    >
      {children}
    </Collapsible>
  </PlanContext.Provider>
);

export type PlanHeaderProps = ComponentProps<typeof CardHeader>;

export const PlanHeader = ({ className, ...props }: PlanHeaderProps) => (
  <CardHeader
    className={cn(
      "flex flex-row items-center justify-between space-y-0",
      className
    )}
    data-slot="plan-header"
    {...props}
  />
);

export type PlanTitleProps = Omit<
  ComponentProps<typeof CardTitle>,
  "children"
> & {
  children: string;
};

export const PlanTitle = ({ children, ...props }: PlanTitleProps) => {
  const { isStreaming } = usePlan();

  return (
    <CardTitle data-slot="plan-title" {...props}>
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </CardTitle>
  );
};

export type PlanDescriptionProps = Omit<
  ComponentProps<typeof CardDescription>,
  "children"
> & {
  children: string;
};

export const PlanDescription = ({
  className,
  children,
  ...props
}: PlanDescriptionProps) => {
  const { isStreaming } = usePlan();

  return (
    <CardDescription
      className={cn("text-balance", className)}
      data-slot="plan-description"
      {...props}
    >
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </CardDescription>
  );
};

export type PlanActionProps = ComponentProps<typeof CardAction>;

export const PlanAction = (props: PlanActionProps) => (
  <CardAction data-slot="plan-action" {...props} />
);

export type PlanContentProps = ComponentProps<typeof CardContent>;

export const PlanContent = (props: PlanContentProps) => (
  <CollapsibleContent>
    <CardContent data-slot="plan-content" {...props} />
  </CollapsibleContent>
);

export type PlanFooterProps = ComponentProps<"div">;

export const PlanFooter = (props: PlanFooterProps) => (
  <CardFooter data-slot="plan-footer" {...props} />
);

export type PlanTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

export const PlanTrigger = ({ className, ...props }: PlanTriggerProps) => (
  <CollapsibleTrigger asChild {...props}>
    <Button
      className={cn("size-8", className)}
      data-slot="plan-trigger"
      size="icon"
      variant="ghost"
    >
      <ChevronsUpDownIcon className="size-4" />
      <span className="sr-only">Toggle plan</span>
    </Button>
  </CollapsibleTrigger>
);

/* -------------------------------------------------------------------------- */
/*                                 Plan Items                                 */
/* -------------------------------------------------------------------------- */

export type PlanStatus = "pending" | "in_progress" | "completed" | "failed";

export interface PlanItemProps extends ComponentProps<"div"> {
  status: PlanStatus;
}

export const PlanItem = ({
  className,
  status,
  children,
  ...props
}: PlanItemProps) => {
  return (
    <div
      className={cn("flex items-start gap-2 text-sm", className)}
      data-slot="plan-item"
      {...props}
    >
      <div className="mt-0.5 flex size-4 items-center justify-center">
        {status === "completed" ? (
          <CheckIcon className="size-3.5 text-green-500" />
        ) : status === "in_progress" ? (
          <Loader2Icon className="size-3.5 animate-spin text-blue-500" />
        ) : status === "failed" ? (
          <div className="size-2 rounded-full bg-red-500" />
        ) : (
          <CircleIcon className="size-3.5 text-muted-foreground" />
        )}
      </div>
      <div
        className={cn(
          "flex-1 text-muted-foreground",
          status === "completed" && "line-through opacity-80",
          status === "in_progress" && "font-medium text-foreground",
          status === "failed" && "text-red-500"
        )}
      >
        {children}
      </div>
    </div>
  );
};
