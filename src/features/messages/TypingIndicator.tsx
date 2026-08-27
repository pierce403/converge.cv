type TypingIndicatorProps = {
  label: string;
};

export function TypingIndicator({ label }: TypingIndicatorProps) {
  return (
    <div className="border-t border-primary-900/40 bg-primary-950/50 px-4 py-2.5">
      <div
        className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md border border-primary-700/70 bg-primary-900/80 px-3 py-2 shadow-sm"
        role="status"
        aria-live="polite"
        aria-label={label}
        title={label}
      >
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-300 motion-reduce:animate-none"
            style={{ animationDelay: `${dot * 140}ms` }}
            data-typing-dot
            aria-hidden="true"
          />
        ))}
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}
