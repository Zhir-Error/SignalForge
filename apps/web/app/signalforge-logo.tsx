import { useId } from "react";

type SignalForgeLogoProps = {
  compact?: boolean;
  className?: string;
  markClassName?: string;
};

export function SignalForgeMark({ className = "" }: { className?: string }) {
  const gradientId = `signalforge-flame-${useId().replace(/:/g, "")}`;

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="22"
          y1="5"
          x2="43"
          y2="38"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFB547" />
          <stop offset="1" stopColor="#F04438" />
        </linearGradient>
      </defs>
      <path
        d="M34.2 4.5C35.3 13.1 29.4 18.8 24.6 23.6C19.7 28.5 17.6 33.1 19.2 38.3C20.7 43.2 25.1 46 31.4 46C40.4 46 46 39.7 46 31.7C46 25.3 42.5 18.7 37.4 14.7C38.8 21.1 36.8 25 33.5 27.4C32.5 19.9 35.5 15.6 34.2 4.5Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M43.1 30.7H28.2C23.5 30.7 20.6 32.9 20.6 36.2C20.6 39.5 23.5 41.5 28.2 41.5H35.8C40.4 41.5 43.3 43.6 43.3 46.9C43.3 50.2 40.4 52.3 35.8 52.3H21.2"
        stroke="#F6F7F9"
        strokeWidth="6.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M40.7 46.4L29.5 56.3H17.8"
        stroke="#1686F7"
        strokeWidth="3.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16.5" cy="56.3" r="3.3" fill="#7DC4FF" />
      <circle cx="43" cy="44.4" r="2.4" fill="#F6F7F9" />
    </svg>
  );
}

export function SignalForgeLogo({
  compact = false,
  className = "",
  markClassName = "",
}: SignalForgeLogoProps) {
  return (
    <span className={`signalforge-logo ${className}`}>
      <SignalForgeMark className={`signalforge-logo__mark ${markClassName}`} />
      {!compact && (
        <span className="signalforge-logo__wordmark">
          Signal<span>Forge</span>
        </span>
      )}
    </span>
  );
}
