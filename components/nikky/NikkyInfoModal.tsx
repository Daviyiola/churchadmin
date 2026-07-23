"use client";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function NikkyInfoModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nikky-info-title"
      onMouseDown={onClose}
    >
      <div
        className="my-auto flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b px-5 py-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                About the assistant
              </div>

              <h2
                id="nikky-info-title"
                className="mt-1 text-xl font-semibold text-slate-900"
              >
                What is Nikky?
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-600">
                Nikky is Church Admin&apos;s conversational assistant, helping authorized 
                users get clear answers from their records using plain language.

              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-xl border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              aria-label="Close"
            >
              Close
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 text-sm leading-6 text-slate-700 sm:px-7">
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="font-semibold text-slate-900">How Nikky works</div>

            <p className="mt-1">
              When you ask Nikky a question, the OpenAI API helps interpret what 
              you are asking and identify the information needed to answer it.
            </p>

            <p className="mt-2">
              Nikky then requests that information through Church Admin&apos;s 
              approved, read-only tools. Church Admin authenticates the user, 
              applies organization and role-based access rules, runs the permitted 
              query, and returns only the information the user is authorized to access.
            </p>

            <p className="mt-2">
              OpenAI then helps Nikky turn the approved results into a clear, 
              conversational response.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="font-semibold text-slate-900">
              Why Nikky uses OpenAI
            </div>

            <p className="mt-1">
              Nikky uses the OpenAI API to understand natural-language questions
              and present the approved information in a clear,
              easy-to-understand format. OpenAI provides the language-processing
              capability behind the conversation, while Church Admin continues
              to control access to your organization&apos;s records.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="font-semibold text-slate-900">
              Church Admin stays in control
            </div>

            <p className="mt-1">
              Nikky cannot independently search your organization&apos;s records
              or decide what information a user may access. Every request must
              pass through Church Admin&apos;s authentication, authorization,
              and approved tool controls.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="font-semibold text-slate-900">
              OpenAI does not have direct database access
            </div>

            <p className="mt-1">
              OpenAI receives the conversation and any relevant information
              Church Admin provides for the response. It does not receive
              database credentials, direct database access, arbitrary query
              access, or permission to independently browse Church Admin
              records.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="font-semibold text-slate-900">
              Your church&apos;s data is not used to train Nikky
            </div>

            <p className="mt-1">
              Church Admin does not train or fine-tune Nikky using your
              organization&apos;s records. OpenAI also states that API inputs
              and outputs are not used to train its models by default unless an
              API customer explicitly opts in.
            </p>

            <a
              href="https://openai.com/business-data/"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800"
            >
              Read OpenAI&apos;s business data privacy statement
            </a>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
            <div className="font-semibold">Grounded, but not infallible</div>

            <p className="mt-1">
              Nikky is designed to base organization-specific answers on current
              information returned through approved Church Admin queries. This
              greatly reduces the chance of invented information, but no AI
              assistant is guaranteed to be error-free.
            </p>

            <p className="mt-2">
              Important answers should still be reviewed against the underlying
              Church Admin records or generated report.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end border-t bg-slate-50 px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/85"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
