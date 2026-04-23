import MantraBlock from "./MantraBlock";
import type { GuideStep } from "@/lib/types/firestore";

export default function StepList({ steps }: { steps: GuideStep[] }) {
  return (
    <ol className="flex flex-col gap-5">
      {steps.map((step) => (
        <li
          key={step.order}
          className="flex flex-col gap-2.5 rounded-2xl border border-border-warm bg-surface p-5 shadow-sm"
        >
          <header className="flex items-baseline gap-3">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-saffron-soft font-mono text-[11px] font-semibold text-saffron-dark">
              {step.order}
            </span>
            <h3 className="font-display text-xl font-semibold text-maroon">
              {step.title}
            </h3>
          </header>
          <p className="text-sm leading-relaxed text-foreground/85">
            {step.instruction}
          </p>
          {step.materials && step.materials.length > 0 ? (
            <p className="text-xs text-muted">
              <span className="font-semibold text-saffron-dark">
                Materials:
              </span>{" "}
              {step.materials.join(", ")}
            </p>
          ) : null}
          {step.mantras?.map((m, i) => (
            <MantraBlock key={i} mantra={m} />
          ))}
          {step.notes ? (
            <p className="text-xs italic text-muted">{step.notes}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
