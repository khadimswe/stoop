import { AppBar, ScreenBody, Stepper, type Step } from "./kit";

/** The shape of a step while it loads: the bar, the stepper and grey blocks where the content goes. */
export function PlanLoading({ step }: { step: Step }) {
  return (
    <>
      <AppBar title="Loading" />
      <Stepper current={step} />
      <ScreenBody>
        <p role="status" className="sr-only">
          Loading
        </p>
        <div aria-hidden="true" className="flex flex-col gap-3">
          <div className="h-4 w-40 rounded bg-fl-band" />
          <div className="h-9 w-4/5 rounded bg-fl-band" />
          <div className="h-16 rounded-[20px] bg-white" />
          <div className="h-48 rounded-[20px] bg-white" />
        </div>
      </ScreenBody>
    </>
  );
}
